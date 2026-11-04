extends Node
## Link from the headset to Muse Carpathron on the PC (the "brain"): Meta Muse models through the PC app.
##   - finds the PC on the Wi-Fi (https://<ip>:8443/avatar/hello)
##   - links once: the headset asks, you click Allow on the PC, the headset keeps its own token
##   - ask(question): Muse Spark looks through the robot camera and answers
##   - voice(wav): Muse Voice Transcribe -> quick robot command or the Muse agent (memory, tools)
##   - look(dir) / scan(): robot head turn + photo, room map
##   - 1.2: the room map (map_data), what the car is doing (state_data) and missions (mission(): explore, scan,
##     measure, find <object>, stop) — Muse Carpathron 2.2.4 or newer

signal changed
signal map_changed

var pc := ""            # "192.168.1.130:8443"
var token := ""
var state := "searching"  # searching | not found | approve | linked
var last_answer := ""
var busy := false

var _cfg: ConfigFile
var _req: HTTPRequest
var _poll: HTTPRequest
var _scanners: Array = []
var _queue: Array = []
var _link_id := ""
var _next_poll := 0
var state_data: Dictionary = {}   # {pose, busy, news, sensors, targets:[{name, kind}]}
var map_data: Dictionary = {}     # {res, half, i0, j0, w, h, cells(base64), pose, places, objects, hazards, route}
var _state_req: HTTPRequest
var _map_req: HTTPRequest
var _mission_req: HTTPRequest
var _view_req: HTTPRequest
var _next_state := 0
var _next_map := 0
var want_vision := false   # 1.4: ask Muse to look at the live picture (people, animals, obstacles, items)
var vision_src := "car"    # 1.5: "car" = the robot's camera, "room" = the headset camera (mixed reality)
var _eyes_req: HTTPRequest
var _comp_req: HTTPRequest
var _audio_req: HTTPRequest
var companion_busy := false
var version := ""          # Muse Carpathron version on the PC (from /avatar/hello)
var _tls := TLSOptions.client_unsafe()   # the PC app uses its own self-signed certificate on the LAN

func setup(cfg: ConfigFile) -> void:
	_cfg = cfg
	pc = cfg.get_value("muse", "pc", "")
	token = cfg.get_value("muse", "token", "")
	_req = _mk(60.0)
	_poll = _mk(4.0)
	_poll.request_completed.connect(_on_poll)
	_state_req = _mk(3.0)
	_state_req.request_completed.connect(func(result, code, _h, b):
		if result == HTTPRequest.RESULT_SUCCESS and code == 200:
			var j = JSON.parse_string(b.get_string_from_utf8())
			if typeof(j) == TYPE_DICTIONARY:
				state_data = j
				changed.emit())
	_map_req = _mk(5.0)
	_map_req.request_completed.connect(func(result, code, _h, b):
		if result == HTTPRequest.RESULT_SUCCESS and code == 200:
			var j = JSON.parse_string(b.get_string_from_utf8())
			if typeof(j) == TYPE_DICTIONARY:
				map_data = j
				map_changed.emit())
	_mission_req = _mk(8.0)
	_view_req = _mk(2.0)
	_eyes_req = _mk(3.0)
	_comp_req = _mk(90.0)
	_audio_req = _mk(40.0)
	for i in 16:
		var s := _mk(0.8)
		s.set_meta("host", "")
		s.request_completed.connect(_on_hello.bind(s))
		_scanners.append(s)
	if pc != "" and token != "":
		state = "linked"
		_hello_check()
	else:
		find()

func _mk(timeout: float) -> HTTPRequest:
	var r := HTTPRequest.new()
	r.timeout = timeout
	r.set_tls_options(_tls)
	add_child(r)
	return r

func _base() -> String:
	return "https://" + pc

func status_text() -> String:
	match state:
		"linked": return "Muse: linked to PC %s" % pc.split(":")[0]
		"approve": return "Muse: click ALLOW on the PC (Muse Carpathron)"
		"not found": return "Muse: PC app not found (open Muse Carpathron on the PC)"
	return "Muse: looking for the PC..."

# ---------------------------------------------------------------- find + link
func find(extra: Array = []) -> void:
	state = "searching"
	_queue = extra.duplicate()
	for a in IP.get_local_addresses():
		var s := str(a)
		if s.begins_with("192.168.") or s.begins_with("10.") or s.begins_with("172."):
			var p := s.split(".")
			for i in range(1, 255):
				var h := "%s.%s.%s.%d:8443" % [p[0], p[1], p[2], i]
				if not _queue.has(h):
					_queue.append(h)
	changed.emit()

func _hello_check() -> void:
	var s: HTTPRequest = _scanners[0]
	s.set_meta("host", pc)
	s.request(_base() + "/avatar/hello", ["x-avatar-token: " + token])

func _on_hello(result: int, code: int, _h: PackedStringArray, body: PackedByteArray, req: HTTPRequest) -> void:
	var host: String = req.get_meta("host")
	req.set_meta("host", "")
	if result != HTTPRequest.RESULT_SUCCESS or code != 200:
		return
	var j = JSON.parse_string(body.get_string_from_utf8())
	if typeof(j) != TYPE_DICTIONARY or str(j.get("app", "")) != "Muse Carpathron":
		return
	version = str(j.get("version", ""))
	if state == "linked" and host == pc:
		if not j.get("linked", false):
			token = ""
			_link(host)   # token no longer valid: ask again
		return
	if state == "searching":
		_queue.clear()
		_link(host)

func _link(host: String) -> void:
	pc = host
	state = "approve"
	changed.emit()
	_req.request_completed.connect(_on_link_started, CONNECT_ONE_SHOT)
	_req.request(_base() + "/avatar/link", ["Content-Type: application/json"], HTTPClient.METHOD_POST, JSON.stringify({"device": "Quest 3S"}))

func _on_link_started(result: int, code: int, _h: PackedStringArray, body: PackedByteArray) -> void:
	var j = JSON.parse_string(body.get_string_from_utf8()) if result == HTTPRequest.RESULT_SUCCESS else null
	if code != 200 or typeof(j) != TYPE_DICTIONARY:
		state = "not found"
		changed.emit()
		return
	_link_id = str(j["id"])
	_next_poll = 0

func _on_poll(result: int, code: int, _h: PackedStringArray, body: PackedByteArray) -> void:
	if result != HTTPRequest.RESULT_SUCCESS:
		return
	var j = JSON.parse_string(body.get_string_from_utf8())
	if code == 404 or typeof(j) != TYPE_DICTIONARY:
		_link_id = ""
		state = "not found"
	elif j.get("status", "") == "allowed":
		token = str(j["token"])
		_link_id = ""
		state = "linked"
		_cfg.set_value("muse", "pc", pc)
		_cfg.set_value("muse", "token", token)
		_cfg.save("user://avatar.cfg")
		last_answer = "Linked to Muse Carpathron. Hold the RIGHT grip and talk, LEFT grip = what do you see?"
	elif j.get("status", "") == "denied":
		_link_id = ""
		state = "not found"
		last_answer = "Link denied on the PC."
	changed.emit()

# ---------------------------------------------------------------- Muse actions
func _call(path: String, body, ctype: String, done: Callable) -> void:
	if state != "linked" or busy:
		return
	busy = true
	var headers := ["x-avatar-token: " + token, "Content-Type: " + ctype]
	_req.request_completed.connect(func(result, code, _hh, b):
		busy = false
		var j = JSON.parse_string(b.get_string_from_utf8()) if result == HTTPRequest.RESULT_SUCCESS else null
		if code == 401:
			state = "not found"; token = ""; find([pc]); changed.emit(); return
		done.call(j if typeof(j) == TYPE_DICTIONARY else {"error": "PC not reachable"})
	, CONNECT_ONE_SHOT)
	if body is PackedByteArray:
		_req.request_raw(_base() + path, headers, HTTPClient.METHOD_POST, body)
	else:
		_req.request(_base() + path, headers, HTTPClient.METHOD_POST, JSON.stringify(body))

func ask(question: String) -> void:
	last_answer = "Muse is looking..."
	changed.emit()
	_call("/avatar/ask", {"question": question}, "application/json", func(j):
		last_answer = str(j.get("answer", j.get("error", "")))
		changed.emit())

func voice(wav: PackedByteArray) -> void:
	last_answer = "Muse is listening..."
	changed.emit()
	_call("/avatar/voice", wav, "audio/wav", func(j):
		if j.has("error"):
			last_answer = str(j["error"])
		else:
			var rs: Array = j.get("replies", [])
			last_answer = "You: %s\n%s" % [str(j.get("heard", "")), "\n".join(rs.map(func(x): return str(x)))]
		changed.emit())

func look(direction: String) -> void:
	_call("/avatar/look", {"direction": direction}, "application/json", func(j): last_answer = "Looked " + direction if j.get("ok", false) else str(j.get("error", "")); changed.emit())

func scan_room() -> void:
	last_answer = "Room scan started: the robot turns a full circle"
	changed.emit()
	_call("/avatar/scan", {}, "application/json", func(_j): pass)

## a mission for the car, run by Muse on the PC: "explore", "scan", "measure", "find" (with name) or "stop"
func mission(action: String, name := "") -> void:
	if state != "linked":
		last_answer = "Missions need Muse Carpathron on the PC (link the headset first)"
		changed.emit()
		return
	if action != "stop" and _mission_req.get_http_client_status() != HTTPClient.STATUS_DISCONNECTED:
		return
	if action == "stop":
		_mission_req.cancel_request()
	last_answer = "Mission: " + action + ((" " + name) if name != "" else "") + "..."
	changed.emit()
	_mission_req.request_completed.connect(func(result, _code, _h, b):
		var j = JSON.parse_string(b.get_string_from_utf8()) if result == HTTPRequest.RESULT_SUCCESS else null
		if typeof(j) == TYPE_DICTIONARY:
			last_answer = str(j.get("text", j.get("error", "")))
		else:
			last_answer = "PC not reachable"
		_next_state = 0
		changed.emit()
	, CONNECT_ONE_SHOT)
	_mission_req.request(_base() + "/avatar/mission", ["x-avatar-token: " + token, "Content-Type: application/json"], HTTPClient.METHOD_POST, JSON.stringify({"action": action, "name": name}))

## 1.4: the headset view for Muse (Robots > Live) — one picture at a time, skipped while the last one is on its way
func view_busy() -> bool:
	return _view_req.get_http_client_status() != HTTPClient.STATUS_DISCONNECTED

func post_view(jpg: PackedByteArray, mode: String) -> void:
	if state != "linked" or view_busy() or jpg.is_empty():
		return
	_view_req.request_raw(_base() + "/avatar/view?mode=" + mode.uri_encode(), ["x-avatar-token: " + token, "Content-Type: image/jpeg"], HTTPClient.METHOD_POST, jpg)

## 1.5: the headset camera picture (mixed reality) — Muse names the room's objects; id = which head pose it was
func post_eyes(jpg: PackedByteArray, id: int) -> bool:
	if state != "linked" or jpg.is_empty() or _eyes_req.get_http_client_status() != HTTPClient.STATUS_DISCONNECTED:
		return false
	_eyes_req.request_raw(_base() + "/avatar/eyes?id=%d" % id, ["x-avatar-token: " + token, "Content-Type: image/jpeg"], HTTPClient.METHOD_POST, jpg)
	return true

## 1.5: talk to Carpathron the companion: wav (push-to-talk) or text; done(reply) with
## {heard, say, action, target, amount, mood, audio:[urls], boxes, mode, doing}
func companion(wav: PackedByteArray, text: String, mode: String, done: Callable) -> void:
	if state != "linked":
		done.call({"say": "Open Muse Carpathron on the PC and link the headset, then we can talk.", "action": "none", "error": "not linked"})
		return
	if companion_busy:
		_comp_req.cancel_request()
	companion_busy = true
	_comp_req.request_completed.connect(func(result, code, _hh, b):
		companion_busy = false
		var j = JSON.parse_string(b.get_string_from_utf8()) if result == HTTPRequest.RESULT_SUCCESS else null
		if code == 401:
			state = "not found"; token = ""; find([pc]); changed.emit()
		if code == 404:
			done.call({"say": "Muse Carpathron on your PC is too old to talk with me. Please install Muse Carpathron 2.3.0.", "action": "none", "mood": "sorry", "error": "old muse"})
		elif typeof(j) == TYPE_DICTIONARY and str(j.get("say", "")) != "":
			done.call(j)
		else:
			done.call({"say": "I can't reach Muse Carpathron on your PC right now." + ((" (" + str(j.get("error", "")) + ")") if typeof(j) == TYPE_DICTIONARY else ""), "action": "none", "mood": "sorry", "error": "PC not reachable"})
	, CONNECT_ONE_SHOT)
	var path := "/avatar/companion?mode=" + mode
	if wav.size() > 0:
		_comp_req.request_raw(_base() + path, ["x-avatar-token: " + token, "Content-Type: audio/wav"], HTTPClient.METHOD_POST, wav)
	else:
		_comp_req.request(_base() + path, ["x-avatar-token: " + token, "Content-Type: application/json"], HTTPClient.METHOD_POST, JSON.stringify({"text": text}))

## true when the PC runs Muse Carpathron 2.3.0 or newer (the companion needs it)
func has_companion() -> bool:
	if version == "":
		return state == "linked"
	var p := version.split(".")
	return p.size() >= 2 and (int(p[0]) > 2 or (int(p[0]) == 2 and int(p[1]) >= 3))

## 1.6: copy the Meta API key saved in Muse Carpathron on the PC into the headset (the headset is linked = allowed)
func get_key(done: Callable) -> void:
	if state != "linked":
		done.call("", "not linked"); return
	var r := _mk(8.0)
	r.request_completed.connect(func(result, code, _h, b):
		r.queue_free()
		var j = JSON.parse_string(b.get_string_from_utf8()) if result == HTTPRequest.RESULT_SUCCESS else null
		if code == 200 and typeof(j) == TYPE_DICTIONARY and str(j.get("key", "")) != "":
			done.call(str(j["key"]), "")
		elif code == 404:
			done.call("", "update Muse Carpathron to 2.3.2")
		else:
			done.call("", str(j.get("error", "no key in Muse")) if typeof(j) == TYPE_DICTIONARY else "PC not reachable"))
	r.request(_base() + "/avatar/apikey", ["x-avatar-token: " + token])

func cancel_companion() -> void:
	if companion_busy:
		_comp_req.cancel_request()
		companion_busy = false

## a spoken sentence (WAV bytes) from Muse; done(bytes) — empty when it failed
func fetch_audio(path: String, done: Callable) -> void:
	if state != "linked":
		done.call(PackedByteArray()); return
	_audio_req.cancel_request()
	for c in _audio_req.request_completed.get_connections():
		_audio_req.request_completed.disconnect(c["callable"])
	_audio_req.request_completed.connect(func(result, code, _hh, b):
		done.call(b if result == HTTPRequest.RESULT_SUCCESS and code == 200 else PackedByteArray())
	, CONNECT_ONE_SHOT)
	_audio_req.request(_base() + path, ["x-avatar-token: " + token])

## where the car video comes through Muse (one shared camera connection on the PC = a steadier picture)
func relay() -> Dictionary:
	if state != "linked" or pc == "":
		return {}
	var p := pc.split(":")
	return {"host": p[0], "port": int(p[1]) if p.size() > 1 else 8443, "token": token}

func _process(_dt: float) -> void:
	var now := Time.get_ticks_msec()
	if state == "linked":
		if now >= _next_state and _state_req.get_http_client_status() == HTTPClient.STATUS_DISCONNECTED:
			_next_state = now + 600
			_state_req.request(_base() + "/avatar/state" + (("?vision=" + ({"car": "1"}.get(vision_src, vision_src))) if want_vision else ""), ["x-avatar-token: " + token])
		if now >= _next_map and _map_req.get_http_client_status() == HTTPClient.STATUS_DISCONNECTED:
			_next_map = now + 2500
			_map_req.request(_base() + "/avatar/map", ["x-avatar-token: " + token])
	if state == "searching":
		var idle := 0
		for s in _scanners:
			if str(s.get_meta("host")) == "":
				if _queue.size() > 0:
					var h: String = _queue.pop_front()
					s.set_meta("host", h)
					if s.request("https://%s/avatar/hello" % h) != OK:
						s.set_meta("host", "")
				else:
					idle += 1
		if idle == _scanners.size() and _queue.is_empty() and state == "searching":
			state = "not found"
			changed.emit()
	if _link_id != "" and now >= _next_poll and _poll.get_http_client_status() == HTTPClient.STATUS_DISCONNECTED:
		_next_poll = now + 1500
		_poll.request(_base() + "/avatar/link/" + _link_id)
