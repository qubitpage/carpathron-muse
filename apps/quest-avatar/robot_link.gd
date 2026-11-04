extends Node
## Link to a robot that speaks the Carpathron Robot Protocol v1 (see ROBOT-PROTOCOL.md):
##   GET  /status            JSON with at least {"name": "..."}       (port 80)
##   GET  /drive?l=..&r=..   wheel speeds -100..100, kept until /stop  (port 80)
##   GET  /stop                                                         (port 80)
##   GET  /capture           one JPEG photo                             (port 80)
##   GET  /stream            MJPEG live video                           (port 81)
## Works directly over Wi-Fi with any such robot (the Baby Carpathron car speaks it), no PC needed.

signal frame(texture: Texture2D)
signal changed
signal felt(kind: String)   # the car felt something (firmware 2.4): "bump", "step", "drop", "blocked", "blind"

var host := ""          # "192.168.1.131" or "192.168.1.131:8080" (then video = port+1)
var robot_name := ""
var online := false
var rssi := 0
var frames := 0
var scanning := false
var found: Array = []   # [{host, name}]
var last_photo := ""
var note := ""
## the car's sensors from /status (Baby Carpathron firmware 2.x; empty with other robots)
var sensors: Dictionary = {}
var _counts := {}
var _was_blocked := false
var _was_lost := false
var _lost_since := 0   # 1.3: a short gap in the Mega lines is normal while video streams; warn only after 2 s

var _tex: ImageTexture
## 1.4: {host, port, token} = take the video through Muse Carpathron on the PC (/avatar/stream, HTTPS) instead of
## straight from the car: the car then serves only one video client, which keeps the picture steady
var relay: Dictionary = {}
var _relay_used := false
var _relay_fail := 0

func set_relay(r: Dictionary) -> void:
	if r == relay:
		return
	relay = r
	_relay_fail = 0
	_video_fail()
	_vretry = 0
# video (MJPEG over a raw HTTPClient)
var _vc: HTTPClient
var _vstate := 0
var _vretry := 0
var _buf := PackedByteArray()
var _last_frame_ms := 0
# control
var _drive_req: HTTPRequest
var _stop_req: HTTPRequest
var _status_req: HTTPRequest
var _photo_req: HTTPRequest
var _busy := false
var _last := Vector2i(9999, 9999)
var _last_at := 0
var _stops_left := 0
var _next_stop_at := 0
var _next_status := 0
# discovery
var _scan_queue: Array = []
var _scan_total := 1
var _scanners: Array = []

func _ready() -> void:
	_drive_req = _mk(1.5); _drive_req.request_completed.connect(func(_r, _c, _h, _b): _busy = false; if OS.has_feature("debug") and _r != 0: print("drive result ", _r))
	_stop_req = _mk(1.0)
	_status_req = _mk(2.0); _status_req.request_completed.connect(_on_status)
	_photo_req = _mk(8.0); _photo_req.request_completed.connect(_on_photo)
	for i in 32:
		var s := _mk(1.6)   # 1.4: a busy car (streaming video) can take more than 0.7 s to answer
		s.request_completed.connect(_on_scan.bind(s))
		s.set_meta("host", "")
		_scanners.append(s)

func _mk(timeout: float) -> HTTPRequest:
	var r := HTTPRequest.new()
	r.timeout = timeout
	r.use_threads = false
	add_child(r)
	return r

func _ctrl_base() -> String:
	return "http://" + host

func _video_host_port() -> Array:
	var parts := host.split(":")
	if parts.size() > 1:
		return [parts[0], int(parts[1]) + 1]
	return [parts[0], 81]

func connect_to(h: String) -> void:
	host = h.strip_edges()
	online = false
	robot_name = ""
	_vstate = 0
	_vretry = 0
	_buf.clear()
	_next_status = 0
	note = "Connecting to " + host
	changed.emit()

# ------------------------------------------------------------------ driving
## Call every frame with the wanted wheel speeds. Sends at once on change, keep-alive every 300 ms, stop 3x.
func drive(l: int, r: int) -> void:
	if host == "":
		return
	var now := Time.get_ticks_msec()
	var v := Vector2i(clampi(l, -100, 100), clampi(r, -100, 100))
	if v == Vector2i.ZERO:
		if _last != Vector2i.ZERO:
			_last = Vector2i.ZERO
			_stops_left = 3
			_next_stop_at = 0
		return
	_stops_left = 0
	if v == _last and now - _last_at < 300:
		return
	if _busy and v == _last:
		return
	if _busy:
		_drive_req.cancel_request()
	_last = v
	_last_at = now
	_busy = true
	_drive_req.request("%s/drive?l=%d&r=%d" % [_ctrl_base(), v.x, v.y])

func stop_now() -> void:
	_last = Vector2i(1, 1)
	drive(0, 0)

func take_photo() -> void:
	if host == "" or _photo_req.get_http_client_status() != HTTPClient.STATUS_DISCONNECTED:
		return
	note = "Taking photo..."
	changed.emit()
	_photo_req.request(_ctrl_base() + "/capture")

func _on_photo(result: int, code: int, _h: PackedStringArray, body: PackedByteArray) -> void:
	if result != HTTPRequest.RESULT_SUCCESS or code != 200 or body.size() < 200:
		note = "Photo failed"
	else:
		DirAccess.make_dir_recursive_absolute("user://photos")
		var t := Time.get_datetime_string_from_system().replace(":", "-")
		last_photo = "user://photos/photo-%s.jpg" % t
		var f := FileAccess.open(last_photo, FileAccess.WRITE)
		if f:
			f.store_buffer(body)
			f.close()
		note = "Photo saved (%d KB)" % (body.size() / 1024)
	changed.emit()

# ------------------------------------------------------------------ status
func _on_status(result: int, code: int, _h: PackedStringArray, body: PackedByteArray) -> void:
	var was := online
	online = result == HTTPRequest.RESULT_SUCCESS and code == 200
	if online:
		var j = JSON.parse_string(body.get_string_from_utf8())
		if typeof(j) == TYPE_DICTIONARY:
			robot_name = str(j.get("name", "robot"))
			rssi = int(j.get("rssi", 0))
			var s = j.get("sensors", null)
			if typeof(s) == TYPE_DICTIONARY:
				sensors = s
				for k in [["bump", "bumps"], ["step", "tiltStops"], ["drop", "cliffStops"]]:
					var n := int(s.get(k[1], 0))
					if _counts.has(k[0]) and n > int(_counts[k[0]]):
						felt.emit(k[0])
					_counts[k[0]] = n
				var bl := bool(s.get("blocked", false))
				if bl and not _was_blocked:
					felt.emit("blocked")
				_was_blocked = bl
				var lost := bool(s.get("linkLost", false))
				var now := Time.get_ticks_msec()
				if not lost:
					_lost_since = 0
				elif _lost_since == 0:
					_lost_since = now
				var long_lost := lost and now - _lost_since >= 2000
				sensors["linkLost"] = long_lost
				if long_lost and not _was_lost:
					felt.emit("blind")
				_was_lost = long_lost
	if was != online:
		note = ("Connected to " + robot_name) if online else ("Robot not answering at " + host)
	changed.emit()

# ------------------------------------------------------------------ discovery
## Looks for robots on this Wi-Fi: every address of the local /24 networks answering /status with a "name".
func scan(extra: Array = []) -> void:
	if scanning:
		return
	scanning = true
	found = found.filter(func(f): return bool(f.get("muse", false)))
	_scan_queue = extra.duplicate()
	for a in IP.get_local_addresses():
		var s := str(a)
		if s.begins_with("192.168.") or s.begins_with("10.") or s.begins_with("172."):
			var p := s.split(".")
			for i in range(1, 255):
				var h := "%s.%s.%s.%d" % [p[0], p[1], p[2], i]
				if h != s and not _scan_queue.has(h):
					_scan_queue.append(h)
	_scan_total = maxi(1, _scan_queue.size())
	note = "Looking for robots on this Wi-Fi..."
	changed.emit()

## 0..1 while searching
func scan_progress() -> float:
	if not scanning:
		return 1.0
	var busy := 0
	for s in _scanners:
		if str(s.get_meta("host")) != "":
			busy += 1
	return clampf(1.0 - float(_scan_queue.size() + busy) / _scan_total, 0.0, 1.0)

## a robot known another way (Muse Carpathron on the PC knows its car): add it once; true when new
func add_found(h: String, name: String, via_muse := false) -> bool:
	for f in found:
		if f["key"] == h or f["host"] == h:
			if via_muse and not f.get("muse", false):
				f["muse"] = true
				return true
			return false
	found.append({"host": h, "name": name, "key": h, "fw": "", "muse": via_muse})
	changed.emit()
	return true

func _on_scan(result: int, code: int, _h: PackedStringArray, body: PackedByteArray, req: HTTPRequest) -> void:
	var h: String = req.get_meta("host")
	req.set_meta("host", "")
	if result == HTTPRequest.RESULT_SUCCESS and code == 200:
		var j = JSON.parse_string(body.get_string_from_utf8())
		if typeof(j) == TYPE_DICTIONARY and j.has("name"):
			# 1.3: the same robot answers as carpathron.local and as its IP: list it once, by its IP
			var ip := str(j.get("ip", ""))
			var key := ip if ip != "" and not h.contains(":") else h
			for f in found:
				if f["key"] == key:
					return
			found.append({"host": key, "name": str(j["name"]), "key": key, "fw": str(j.get("fw", ""))})
			changed.emit()

func _scan_poll() -> void:
	if not scanning:
		return
	var idle := 0
	for s in _scanners:
		if str(s.get_meta("host")) == "":
			if _scan_queue.size() > 0:
				var h: String = _scan_queue.pop_front()
				s.set_meta("host", h)
				if s.request("http://%s/status" % h) != OK:
					s.set_meta("host", "")
			else:
				idle += 1
	if idle == _scanners.size() and _scan_queue.is_empty():
		scanning = false
		note = ("Found %d robot(s)" % found.size()) if found.size() > 0 else "No robot found on this Wi-Fi"
		changed.emit()

# ------------------------------------------------------------------ video (MJPEG)
func _video_poll() -> void:
	if host == "":
		return
	var now := Time.get_ticks_msec()
	match _vstate:
		0:
			if now < _vretry:
				return
			var hp := _video_host_port()
			_vc = HTTPClient.new()
			_relay_used = not relay.is_empty() and _relay_fail % 3 != 2   # every third try straight to the car
			var err := _vc.connect_to_host(relay["host"], relay["port"], TLSOptions.client_unsafe()) if _relay_used else _vc.connect_to_host(hp[0], hp[1])
			if err != OK:
				_video_fail()
				return
			_vstate = 1
			_last_frame_ms = now
		1:
			_vc.poll()
			var s := _vc.get_status()
			if s == HTTPClient.STATUS_CONNECTED:
				if _relay_used:
					_vc.request(HTTPClient.METHOD_GET, "/avatar/stream", ["Accept: multipart/x-mixed-replace", "x-avatar-token: " + str(relay["token"])])
				else:
					_vc.request(HTTPClient.METHOD_GET, "/stream", ["Accept: multipart/x-mixed-replace"])
				_vstate = 2
			elif s != HTTPClient.STATUS_CONNECTING and s != HTTPClient.STATUS_RESOLVING:
				_video_fail()
		2:
			_vc.poll()
			var s2 := _vc.get_status()
			if s2 == HTTPClient.STATUS_BODY:
				_vstate = 3
			elif s2 != HTTPClient.STATUS_REQUESTING:
				_video_fail()
		3:
			for i in 16:
				_vc.poll()
				if _vc.get_status() != HTTPClient.STATUS_BODY:
					_video_fail()
					return
				var chunk := _vc.read_response_body_chunk()
				if chunk.is_empty():
					break
				_buf.append_array(chunk)
			_extract()
	if _vstate >= 1 and now - _last_frame_ms > 4000:
		if _relay_used:
			_relay_fail += 1
		_video_fail()   # no picture for 4 s: reconnect (through Muse; every third try straight to the car)

func _video_fail() -> void:
	if _vc:
		_vc.close()
	_vstate = 0
	_buf.clear()
	_vretry = Time.get_ticks_msec() + 700

static func _find2(b: PackedByteArray, a: int, c: int, from: int) -> int:
	var i := from
	var n := b.size()
	while true:
		i = b.find(a, i)
		if i < 0 or i + 1 >= n:
			return -1
		if b[i + 1] == c:
			return i
		i += 1
	return -1

func _extract() -> void:
	var newest := PackedByteArray()
	while true:
		var s := _find2(_buf, 0xFF, 0xD8, 0)
		if s < 0:
			if _buf.size() > 400000:
				_buf.clear()
			break
		var e := _find2(_buf, 0xFF, 0xD9, s + 2)
		if e < 0:
			if s > 0:
				_buf = _buf.slice(s)
			break
		newest = _buf.slice(s, e + 2)
		_buf = _buf.slice(e + 2)
	if newest.is_empty():
		return
	var img := Image.new()
	if img.load_jpg_from_buffer(newest) != OK:
		return
	if _tex == null or _tex.get_width() != img.get_width() or _tex.get_height() != img.get_height():
		_tex = ImageTexture.create_from_image(img)
	else:
		_tex.update(img)
	frames += 1
	_last_frame_ms = Time.get_ticks_msec()
	frame.emit(_tex)

func _process(_dt: float) -> void:
	var now := Time.get_ticks_msec()
	_video_poll()
	_scan_poll()
	if _stops_left > 0 and now >= _next_stop_at and host != "":
		_stops_left -= 1
		_next_stop_at = now + 250
		_stop_req.cancel_request()
		_stop_req.request(_ctrl_base() + "/stop")
	if host != "" and now >= _next_status and _status_req.get_http_client_status() == HTTPClient.STATUS_DISCONNECTED:
		_next_status = now + 400   # 1.2: fast enough for the distance and warning dashboard
		_status_req.request(_ctrl_base() + "/status")
