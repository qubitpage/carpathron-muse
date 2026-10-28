extends Node
## Link from the headset to Muse Carpathron on the PC (the "brain"): Meta Muse models through the PC app.
##   - finds the PC on the Wi-Fi (https://<ip>:8443/avatar/hello)
##   - links once: the headset asks, you click Allow on the PC, the headset keeps its own token
##   - ask(question): Muse Spark looks through the robot camera and answers
##   - voice(wav): Muse Voice Transcribe -> quick robot command or the Muse agent (memory, tools)
##   - look(dir) / scan(): robot head turn + photo, room map

signal changed

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
var _tls := TLSOptions.client_unsafe()   # the PC app uses its own self-signed certificate on the LAN

func setup(cfg: ConfigFile) -> void:
	_cfg = cfg
	pc = cfg.get_value("muse", "pc", "")
	token = cfg.get_value("muse", "token", "")
	_req = _mk(60.0)
	_poll = _mk(4.0)
	_poll.request_completed.connect(_on_poll)
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

func _process(_dt: float) -> void:
	var now := Time.get_ticks_msec()
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
