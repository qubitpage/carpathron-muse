extends Node
## Carpathron Avatar 1.6.1 — realtime speech to text (Meta Muse Voice Transcribe over a WebSocket).
## Your words are sent WHILE you talk, so the text is ready a moment after you stop, instead of uploading the whole
## recording afterwards and waiting 2–3 s for it. Straight to Meta with the headset's key (standalone), or through
## Muse on the PC (which adds its key). Anything goes wrong → done(text="", err) and the caller sends the recording.

const RATE := 16000
var ws: WebSocketPeer = null
var _key := ""
var _hs_sent := false
var acked := false
var _ended := false
var _end_sent := false
var _text := ""                      # latest transcript (partial or final)
var _out := PackedByteArray()        # 16 kHz s16 waiting to be sent
var _src := PackedFloat32Array()     # mic samples not resampled yet
var _ratio := 3.0
var _gain := 1.0
var _done: Callable
var _deadline := 0
var t_end := 0                       # when you stopped talking (for the log)

func busy() -> bool:
	return ws != null

## start a session (call when you start talking); returns false when it can't even try
func begin(url: String, key: String, headers: PackedStringArray, tls: TLSOptions, mix_rate: float, mic_peak: float) -> bool:
	cancel()
	ws = WebSocketPeer.new()
	ws.handshake_headers = headers
	ws.outbound_buffer_size = 1 << 20
	if ws.connect_to_url(url, tls) != OK:
		ws = null
		return false
	_key = key
	_hs_sent = false; acked = false; _ended = false; _end_sent = false
	_text = ""; _out = PackedByteArray(); _src = PackedFloat32Array()
	_ratio = mix_rate / RATE
	_gain = clampf(0.3 / maxf(mic_peak, 0.02), 1.0, 6.0)   # quiet headset microphones are raised
	_done = Callable()
	_deadline = Time.get_ticks_msec() + 15000
	return true

## microphone samples (mono, at the mix rate)
func feed(mono: PackedFloat32Array) -> void:
	if ws == null or _ended:
		return
	_src.append_array(mono)
	var n := int(_src.size() / _ratio)
	if n <= 0:
		return
	var b := PackedByteArray()
	b.resize(n * 2)
	for i in n:
		var a := int(i * _ratio); var z := mini(_src.size(), int((i + 1) * _ratio))
		var s := 0.0
		for j in range(a, z):
			s += _src[j]
		s = s / maxi(1, z - a) * _gain
		b.encode_s16(i * 2, int(clampf(s, -1.0, 1.0) * 32767.0))
	_src = _src.slice(int(n * _ratio))
	_out.append_array(b)

## you stopped talking: get the final words
func finish(done: Callable) -> void:
	if ws == null:
		done.call("", "no session")
		return
	_ended = true
	_done = done
	t_end = Time.get_ticks_msec()
	_deadline = t_end + (2500 if acked else 3500)

func cancel() -> void:
	if ws != null:
		ws.close()
	ws = null
	_done = Callable()

func _finish(text: String, err: String) -> void:
	var d := _done
	if ws != null:
		ws.close()
	ws = null
	_done = Callable()
	if d.is_valid():
		d.call(text.replace("。", ".").strip_edges(), err)

func _process(_dt: float) -> void:
	if ws == null:
		return
	ws.poll()
	var st := ws.get_ready_state()
	# the final words can arrive together with the close: read everything first
	while ws.get_available_packet_count() > 0:
		var pk := ws.get_packet()
		var j = JSON.parse_string(pk.get_string_from_utf8())
		if typeof(j) != TYPE_DICTIONARY:
			continue
		var ty := str(j.get("type", ""))
		if ty == "":
			acked = true          # {"sessionId": ...}
		elif ty == "error":
			print("CARPATHRON_RT_ASR error ", str(j.get("message", "")))
			_finish("", "realtime: " + str(j.get("message", "error")))
			return
		elif ty == "transcript":
			_text = str(j.get("transcript", ""))
			if bool(j.get("final", false)) and _ended:
				print("CARPATHRON_RT_ASR final %d ms after you stopped" % (Time.get_ticks_msec() - t_end))
				_finish(_text, "")
				return
	if st == WebSocketPeer.STATE_OPEN:
		if not _hs_sent:
			_hs_sent = true
			var hs := {"audioEncoding": "PCM_16KHZ", "model": "muse-voice-transcribe-1.0", "mode": "PUSH_TO_TALK",
				"partialMode": "CUMULATIVE", "emitAudioProgress": false, "languageBias": ["English"]}
			if _key != "":
				hs["authorization"] = {"accessToken": "Bearer " + _key}
			ws.send_text(JSON.stringify(hs))
		if acked:
			# about 120 ms of audio per frame; what was said during the handshake goes at once (well under 5 s)
			while _out.size() >= 3840 or (_ended and _out.size() > 0):
				var k := mini(_out.size(), 3840 * 8)
				ws.put_packet(_out.slice(0, k))
				_out = _out.slice(k)
			if _ended and not _end_sent and _out.is_empty():
				_end_sent = true
				ws.send_text("{\"type\":\"endStream\"}")
	elif st == WebSocketPeer.STATE_CLOSED:
		# closed: the final may have come just before; otherwise the caller falls back to the recording
		if _ended:
			_finish(_text if _end_sent else "", "" if (_end_sent and _text != "") else "closed (%d)" % ws.get_close_code())
		else:
			ws = null
		return
	if _ended and Time.get_ticks_msec() > _deadline:
		_finish("", "timeout")
	elif not _ended and Time.get_ticks_msec() > _deadline and not acked:
		cancel()
