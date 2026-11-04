extends Node
## Carpathron Avatar 1.6 — the companion's brain on the headset itself (standalone, no PC needed).
## With a Meta API key in Settings the Quest talks to Meta's models directly:
##   Muse Voice Transcribe (what you said) -> Muse Spark (Carpathron's answer + an action, quick reasoning)
##   Muse Spark with the headset camera picture (the objects in your room, every ~2 s).
## Same personality, quick commands, actions and memory as Muse Carpathron on the PC (backend/companion.js).

const BASE := "https://api.meta.ai/v1"
const ACTIONS := ["none", "come", "follow", "stay", "goto", "forward", "back", "left", "right", "spin", "dance", "wave", "look", "outline", "stop", "explore", "scan", "photo"]
const MOODS := ["happy", "curious", "thinking", "excited", "calm", "sorry", "proud"]
const KINDS := ["human", "animal", "obstacle", "furniture", "item", "door"]
const ROOM_PROMPT := "You are the eyes of Carpathron, a friendly robot companion. The picture comes from the camera of a VR headset, at the eye height of the person wearing it, in their room. Find people, animals (pets), furniture, doors, obstacles on the floor and notable items. A small robot car (white or grey body, yellow wheels, round eyes) is \"robot car\" — always list it when you see it. Reply with JSON only, no text: {\"objects\":[{\"label\":\"short name\",\"kind\":\"human|animal|obstacle|furniture|item|door\",\"box\":[x,y,w,h],\"dist\":metres,\"near\":true|false}]} where box is the bounding box in fractions of the picture (0..1, x,y = top-left) and dist your best estimate of the distance from the camera in metres. At most 10 objects, the most interesting first. near = closer than about 1 m."

const CAR_PROMPT := "You are the eyes of a small robot car; the camera is about 10 cm above the floor. Find what matters for driving and for a person watching: people, animals (pets), obstacles in the way, furniture, doors and notable items. Reply with JSON only, no text: {\"objects\":[{\"label\":\"short name\",\"kind\":\"human|animal|obstacle|furniture|item|door\",\"box\":[x,y,w,h],\"near\":true|false}]} where box is the bounding box in fractions of the picture (0..1, x,y = top-left). At most 8 objects, the most important first. near = closer than about 50 cm or blocking the way."
var car_busy := false
var _cvis: HTTPRequest
var key := ""
var base := BASE      # tests point this at a local fake Meta API
var model := "muse-spark-1.3"
var history: Array = []
var busy := false
var last_error := ""
var _asr: HTTPRequest
var _chat: HTTPRequest
var _vis: HTTPRequest
var vision_busy := false

func _ready() -> void:
	_asr = _mk(60.0)
	_chat = _mk(60.0)
	_vis = _mk(30.0)
	_cvis = _mk(30.0)

func _mk(t: float) -> HTTPRequest:
	var r := HTTPRequest.new()
	r.timeout = t
	add_child(r)
	return r

func has_key() -> bool:
	return key.length() >= 8

func _headers(ct := "application/json") -> PackedStringArray:
	return PackedStringArray(["Authorization: Bearer " + key, "Content-Type: " + ct, "Accept: application/json"])

static func _err(code: int, b: PackedByteArray) -> String:
	var t := b.get_string_from_utf8()
	var j = JSON.parse_string(t)
	if typeof(j) == TYPE_DICTIONARY:
		var e = j.get("error", j.get("message", ""))
		if typeof(e) == TYPE_DICTIONARY:
			e = e.get("message", "")
		if str(e) != "":
			return "HTTP %d: %s" % [code, str(e)]
	return "HTTP %d" % code if code != 0 else "no connection to Meta (Wi-Fi?)"

# ---------------------------------------------------------------- speech to text
func transcribe(wav: PackedByteArray, done: Callable) -> void:
	var boundary := "----carpathron%d" % Time.get_ticks_usec()
	var body := PackedByteArray()
	body.append_array(("--%s\r\nContent-Disposition: form-data; name=\"request\"\r\nContent-Type: application/json\r\n\r\n" % boundary).to_utf8_buffer())
	body.append_array(JSON.stringify({"model": "muse-voice-transcribe-1.0", "audioEncoding": "WAV", "mode": "PUSH_TO_TALK"}).to_utf8_buffer())
	body.append_array(("\r\n--%s\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"voice.wav\"\r\nContent-Type: audio/wav\r\n\r\n" % boundary).to_utf8_buffer())
	body.append_array(wav)
	body.append_array(("\r\n--%s--\r\n" % boundary).to_utf8_buffer())
	_asr.request_completed.connect(func(result, code, _h, b):
		if result != HTTPRequest.RESULT_SUCCESS or code != 200:
			last_error = "Transcription: " + _err(code if result == HTTPRequest.RESULT_SUCCESS else 0, b)
			done.call("", last_error)
			return
		var j = JSON.parse_string(b.get_string_from_utf8())
		var text := ""
		if typeof(j) == TYPE_DICTIONARY:
			text = str(j.get("transcript", j.get("text", "")))
			if text == "" and typeof(j.get("turns")) == TYPE_ARRAY:
				text = " ".join((j["turns"] as Array).map(func(t): return str(t.get("transcript", ""))))
		done.call(text.strip_edges(), ""), CONNECT_ONE_SHOT)
	_asr.request_raw(base + "/asr/transcribe", _headers("multipart/form-data; boundary=" + boundary), HTTPClient.METHOD_POST, body)

# ---------------------------------------------------------------- one model call
func chat(messages: Array, req: HTTPRequest, done: Callable) -> void:
	var body := {"model": model, "messages": messages, "stream": false, "reasoning_effort": "minimal"}
	req.request_completed.connect(func(result, code, _h, b):
		if result != HTTPRequest.RESULT_SUCCESS or code != 200:
			last_error = _err(code if result == HTTPRequest.RESULT_SUCCESS else 0, b)
			done.call("", last_error)
			return
		var j = JSON.parse_string(b.get_string_from_utf8())
		var txt := ""
		if typeof(j) == TYPE_DICTIONARY and typeof(j.get("choices")) == TYPE_ARRAY and not (j["choices"] as Array).is_empty():
			var m = j["choices"][0].get("message", {})
			var c = m.get("content", "")
			if typeof(c) == TYPE_ARRAY:
				c = "".join((c as Array).map(func(x): return str(x.get("text", "")) if typeof(x) == TYPE_DICTIONARY else str(x)))
			txt = str(c)
		done.call(txt, ""), CONNECT_ONE_SHOT)
	var e := req.request(base + "/chat/completions", _headers(), HTTPClient.METHOD_POST, JSON.stringify(body))
	if e != OK:
		done.call("", "request error %d" % e)

## check the key: a tiny call; done(ok: bool, message)
func test_key(done: Callable) -> void:
	chat([{"role": "user", "content": "Reply with the word OK."}], _chat, func(txt, err):
		done.call(err == "" and txt != "", err if err != "" else ("Meta answered: " + txt.substr(0, 40))))

# ---------------------------------------------------------------- the room: objects in the headset picture
func room_vision(jpg: PackedByteArray, done: Callable) -> void:
	if vision_busy or not has_key():
		return
	vision_busy = true
	_vision(ROOM_PROMPT, "What is in this room?", jpg, _vis, func(seen, err):
		vision_busy = false
		done.call(seen, err))

## the real car's camera picture: what Baby Carpathron sees (people, pets, obstacles...)
func car_vision(jpg: PackedByteArray, done: Callable) -> void:
	if car_busy or not has_key():
		return
	car_busy = true
	_vision(CAR_PROMPT, "What is in this picture?", jpg, _cvis, func(seen, err):
		car_busy = false
		done.call(seen, err))

func _vision(prompt: String, ask: String, jpg: PackedByteArray, req: HTTPRequest, done: Callable) -> void:
	var msgs := [{"role": "system", "content": prompt},
		{"role": "user", "content": [{"type": "text", "text": ask}, {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + Marshalls.raw_to_base64(jpg)}}]}]
	chat(msgs, req, func(txt, err):
		if err != "":
			done.call([], err)
			return
		var a: int = txt.find("{"); var b: int = txt.rfind("}")
		var j = JSON.parse_string(txt.substr(a, b - a + 1)) if a >= 0 and b > a else null
		var out: Array = []
		if typeof(j) == TYPE_DICTIONARY and typeof(j.get("objects")) == TYPE_ARRAY:
			for o in (j["objects"] as Array).slice(0, 10):
				if typeof(o) != TYPE_DICTIONARY or typeof(o.get("box")) != TYPE_ARRAY or (o["box"] as Array).size() < 4:
					continue
				var bx: Array = (o["box"] as Array).map(func(v): return clampf(float(v), 0.0, 1.0))
				if bx[2] < 0.01 or bx[3] < 0.01:
					continue
				var d := float(o.get("dist", 0))
				var e := {"label": str(o.get("label", "object")).substr(0, 30), "kind": str(o.get("kind", "item")) if str(o.get("kind", "item")) in KINDS else "item", "box": bx, "near": bool(o.get("near", false))}
				if d > 0:
					e["dist"] = snappedf(minf(8.0, d), 0.1)
				out.append(e)
		done.call(out, ""))

# ---------------------------------------------------------------- the companion
static func clean(s: String, n := 400) -> String:
	var r := s
	for c in ["*", "_", "`", "#", ">"]:
		r = r.replace(c, "")
	return " ".join(r.split(" ", false)).strip_edges().substr(0, n)

## short clear commands: answered at once, no model call
## the transcriber often mishears his name: drop it at the start ("Vivekarpatron, ...", "car patron ...")
static func strip_name(text: String) -> String:
	var rx := RegEx.create_from_string("(?i)^\\s*(hey\\s+|ok(ay)?\\s+|hi\\s+)?([a-z]*\\s?)?(car|kar|ca)\\s?(pa|pe)th?(r|l)on[a-z]*[,.!]?\\s*(patron[,.!]?\\s*)?")
	var r := rx.sub(text, "").strip_edges()
	return r if r != "" else text

static func quick(text: String) -> Dictionary:
	var t := strip_name(text).to_lower().strip_edges()
	for p in ["hey ", "ok ", "okay ", "please ", "carpathron, ", "carpathron "]:
		if t.begins_with(p):
			t = t.substr(p.length())
	for c in [".", "!", "?", ","]:
		t = t.replace(c, "")
	for p in [" please", " now", " carpathron"]:
		if t.ends_with(p):
			t = t.substr(0, t.length() - p.length())
	t = t.strip_edges()
	if t == "" or t.split(" ").size() > 6:
		return {}
	var table := {
		"stop": ["stop", "halt", "freeze", "stop it", "stop now"],
		"stay": ["stay", "wait", "stay there", "stay here", "wait there", "wait here"],
		"come": ["come here", "come to me", "come over here", "come over", "come back", "come"],
		"follow": ["follow me", "follow", "come with me"],
		"dance": ["dance", "dance for me", "do a dance", "let's dance"],
		"wave": ["wave", "say hi", "say hello", "wave at me"],
		"spin": ["spin", "turn around", "spin around", "do a spin"],
		"there": ["go there", "walk there", "move there", "go over there", "come there"],
		"scan": ["scan", "scan the room", "scan all the room", "look around", "look around the room", "scan around"],
	}
	var says := {"stop": ["Okay, stopping.", "calm"], "stay": ["Sure, I'll wait right here.", "calm"], "come": ["Coming!", "happy"], "follow": ["Right behind you!", "excited"],
		"dance": ["Watch my moves!", "excited"], "wave": ["Hi there!", "happy"], "spin": ["Wheee!", "excited"], "there": ["Okay, over there!", "happy"], "scan": ["Okay, let me have a good look around!", "curious"]}
	for a in table:
		if t in table[a]:
			return {"say": says[a][0], "mood": says[a][1], "action": "goto" if a == "there" else a, "target": "there" if a == "there" else "", "amount": 0, "quick": true}
	# "search for dogs", "find the dog": the car looks around step by step and goes to it
	var sx := RegEx.create_from_string("^(?:search(?: for)?|look for|find|go find|can you find|where is|where are|where's)(?: the| a| an| my| some| any)? ([a-z][a-z ]{1,24})$")
	var sm := sx.search(t)
	if sm:
		var w := RegEx.create_from_string("([^su])s$").sub(RegEx.create_from_string("(s|x|ch|sh)es$").sub(sm.get_string(1), "$1"), "$1")
		return {"say": "Okay, let me look for the %s!" % w, "mood": "curious", "action": "goto", "target": w, "amount": 0, "quick": true}
	var rx := RegEx.create_from_string("^(?:go|walk|drive|move|run) (?:to|over to|near) (?:the |that |this |my )?([a-z][a-z ]{1,24})$")
	var m := rx.search(t)
	if m:
		return {"say": "On my way to the %s!" % m.get_string(1), "mood": "happy", "action": "goto", "target": m.get_string(1), "amount": 0, "quick": true}
	return {}

static func parse(txt: String) -> Dictionary:
	var a := txt.find("{"); var b := txt.rfind("}")
	var j = JSON.parse_string(txt.substr(a, b - a + 1)) if a >= 0 and b > a else null
	if typeof(j) != TYPE_DICTIONARY:
		return {"say": clean(txt) if clean(txt) != "" else "Sorry, could you say that again?", "action": "none", "target": "", "amount": 0, "mood": "sorry"}
	var act := str(j.get("action", "none")).to_lower()
	if act not in ACTIONS:
		act = "none"
	var mood := str(j.get("mood", "happy")).to_lower()
	return {"say": clean(str(j.get("say", ""))) if clean(str(j.get("say", ""))) != "" else ("Hmm?" if act == "none" else "On it!"),
		"action": act, "target": clean(str(j.get("target", "")), 40), "amount": float(j.get("amount", 0)) if typeof(j.get("amount", 0)) in [TYPE_INT, TYPE_FLOAT] else 0.0,
		"mood": mood if mood in MOODS else "happy"}

## one conversation turn. ctx: {real: bool, objects: [String], jpg: PackedByteArray (only for visual questions)}
func turn(text: String, ctx: Dictionary, done: Callable) -> void:
	var q := quick(text)
	if not q.is_empty():
		history.append({"role": "user", "content": text.substr(0, 600)})
		history.append({"role": "assistant", "content": JSON.stringify({"say": q["say"], "action": q["action"], "target": q["target"]})})
		done.call(q)
		return
	if busy:
		done.call({"say": "One moment, I'm still thinking about the last thing you said.", "action": "none", "mood": "thinking"})
		return
	busy = true
	var real := bool(ctx.get("real", false))
	var objs: Array = ctx.get("objects", [])
	var jpg: PackedByteArray = ctx.get("jpg", PackedByteArray())
	var lines: Array = [
		"You are Baby Carpathron, a small REAL robot car (4 wheels, round eyes, a camera 10 cm above the floor) and the user's companion. The user wears a Meta Quest 3 headset in the same room and talks to you. You are NOT a virtual robot: your actions really drive you, so be careful and only move when asked." if real else "You are Carpathron, a small friendly robot and the user's companion. The user wears a Meta Quest 3 headset in their real room. They see you as a 3D robot (about 1 m tall) standing in their real room (mixed reality). You walk on their floor.",
		("The picture is what YOUR OWN camera sees right now, from the floor. Talk about it as what you see (\"I can see...\")." if real else "The picture is what the user sees right now (headset camera).") if jpg.size() > 0 else "",
		("Your camera recognised: " + "; ".join(ctx.get("car_objects", [])) + ".") if not (ctx.get("car_objects", []) as Array).is_empty() else "",
		("Things the headset has seen in this room (newest first): " + "; ".join(objs) + ".") if not objs.is_empty() else ("" if real else "You have not seen the room yet: if it fits, ask the user to look around slowly so you can learn it."),
		"Talk like a warm, witty, curious human friend, not an assistant: 1-3 short spoken sentences, natural and casual (contractions, a little humour, real reactions), no lists, no markdown, no emoji. Never say you are an AI model. Use the room: notice and mention what you see when it fits. Remember the conversation and refer back to it. Now and then ask the user a short question back, so it feels like a real conversation. Reply in the user's language.",
		"When the user gives you a task, do it with ONE action. Reply with JSON only:",
		"{\"say\":\"what you say aloud\",\"action\":\"none|come|follow|stay|goto|forward|back|left|right|spin|dance|wave|look|outline|stop|explore|scan|photo\",\"target\":\"an object (for goto / outline)\",\"amount\":metres or degrees,\"mood\":\"happy|curious|thinking|excited|calm|sorry|proud\"}",
		"Actions: none = just talk; come = come to the user; follow = follow the user; stay = stay where you are; goto = go to, look for, search for or find something (target, e.g. dog; never spin or scan to look for something); forward/back = move amount metres; left/right = turn amount degrees; spin = turn around; dance; wave; look = tell what you see; outline = point out an object (target); stop.",
	]
	var sys := "\n".join(PackedStringArray(lines.filter(func(x): return str(x) != "")))
	var user: Variant = text.substr(0, 600)
	if jpg.size() > 0:
		user = [{"type": "text", "text": text.substr(0, 600)}, {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + Marshalls.raw_to_base64(jpg)}}]
	var msgs: Array = [{"role": "system", "content": sys}]
	msgs.append_array(history.slice(maxi(0, history.size() - 12)))
	msgs.append({"role": "user", "content": user})
	var t0 := Time.get_ticks_msec()
	# hedge: if Meta hasn't answered in 3.5 s the same question goes again; the first answer wins
	var st := {"done": false, "n": 1, "fails": 0}
	var finish := func(txt: String, err: String):
		if st["done"]:
			return
		if err != "":
			st["fails"] = int(st["fails"]) + 1
			if int(st["fails"]) < int(st["n"]):
				return          # the other one may still answer
		st["done"] = true
		busy = false
		if err != "":
			done.call({"say": "I can't reach Meta's models right now (" + err + ").", "action": "none", "mood": "sorry", "error": err})
			return
		var out := parse(txt)
		history.append({"role": "user", "content": text.substr(0, 600)})
		history.append({"role": "assistant", "content": JSON.stringify(out)})
		if history.size() > 24:
			history = history.slice(history.size() - 24)
		out["ms"] = {"llm": Time.get_ticks_msec() - t0, "picture": jpg.size() > 0, "hedged": int(st["n"]) > 1}
		done.call(out)
	chat(msgs, _free_req(), finish)
	get_tree().create_timer(hedge_s).timeout.connect(func():
		if not st["done"]:
			st["n"] = 2
			print("CARPATHRON_BRAIN slow answer: asking again in parallel")
			chat(msgs, _free_req(), finish))

var hedge_s := 3.5
var _pool: Array = []

## a chat request that isn't busy (a slower, losing request may still be running)
func _free_req() -> HTTPRequest:
	for r in [_chat] + _pool:
		if (r as HTTPRequest).get_http_client_status() == HTTPClient.STATUS_DISCONNECTED:
			return r
	var n := _mk(60.0)
	_pool.append(n)
	return n
