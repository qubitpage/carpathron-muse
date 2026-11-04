extends Node
## Carpathron Avatar 1.5 — talking with Carpathron (the companion), in the headset.
##  - ears: the headset microphone through an AudioEffectCapture. Push-to-talk (hold the right grip) or hands-free:
##    speech is noticed by its loudness, recorded with a short lead-in so the first word is kept, and sent when you
##    pause. While Carpathron speaks, hands-free does not listen (no echo); squeezing the grip interrupts him at once.
##  - brain: Muse Carpathron on the PC (/avatar/companion): what you said + the room picture -> answer + action.
##  - voice: the answer comes back sentence by sentence as natural speech (WAV); the first sentence plays while the
##    next ones are still being made. Played from Carpathron's head (3D sound) or, with the real car, in the headset.

signal state_changed(state: String)          # idle | listening | thinking | speaking
signal replied(reply: Dictionary)            # the whole answer (say, action, target, mood, heard, ...)
signal level(v: float)
signal mic_silent()                          # 1.6.8: the microphone delivers only zeros: restart it                       # speaking loudness 0..1 (mouth / eyes)

const RATE_OUT := 16000
var muse: Node
var capture: AudioEffectCapture
var mix_rate := 48000.0
var player: Node = null                       # AudioStreamPlayer3D on the robot, or AudioStreamPlayer
var mode_fn: Callable                         # -> "demo" / "real"
var hands_free := false
var state := "idle"
var _rec := PackedFloat32Array()             # mono samples at mix rate while recording
var _pre := PackedFloat32Array()             # the last 0.35 s before speech started (lead-in)
var _ptt := false
var _voice_ms := 0.0
var _quiet_ms := 0.0
var _queue: Array = []                        # audio urls still to play
var _env := PackedFloat32Array()              # loudness every 40 ms of the sentence playing
var _play_t := 0.0
var _deaf_until := 0
var noise := 0.004                            # background level (adapts)
var test_wav := PackedByteArray()             # automated test: what "the user says"
# 1.6 standalone: the brain on the headset (Meta API key) and the headset's own speech engine
var local: Node = null                        # brain_local.gd
var brain_fn: Callable                        # -> "pc" / "headset"
var ctx_fn: Callable                          # (text) -> {real, objects, jpg} for the headset brain
var speech: Object = null                     # Android plugin CarpathronRoomCam (ttsSay / ttsState)
var speech_rate := 1.0
var _tts_wait := {}
var active := true                            # only the talk in use plays what Carpathron says by himself
var rt: Node = null                           # rt_asr.gd: words sent while you talk
var rt_fn: Callable                           # -> {url, key, headers, tls} or {} (no realtime speech)
var _rt_on := false
var _said_id := 0                           # {id, path, since} while a sentence is being made

func _ready() -> void:
	mix_rate = AudioServer.get_mix_rate()
	rt = preload("res://rt_asr.gd").new()
	add_child(rt)

var peak := 0.0                               # loudest microphone level in the last seconds (log)

func set_state(s: String) -> void:
	if s != state:
		state = s
		print("CARPATHRON_TALK_STATE ", s)
		state_changed.emit(s)

## grip pressed: interrupt Carpathron and listen; released: send what you said
func ptt(down: bool) -> void:
	if down and not _ptt:
		_ptt = true
		interrupt()
		_start_rec()
	elif not down and _ptt:
		_ptt = false
		_finish_rec()

func interrupt() -> void:
	_rt_stop()
	_queue.clear()
	_tts_wait = {}
	if player and player.playing:
		player.stop()
	if muse and muse.companion_busy:
		muse.cancel_companion()
	_env = PackedFloat32Array()
	level.emit(0.0)
	if state in ["speaking", "thinking"]:
		set_state("idle")

func _start_rec() -> void:
	_rec = _pre.duplicate()
	_voice_ms = 0.0; _quiet_ms = 0.0
	set_state("listening")
	# realtime speech to text: start sending right away (the lead-in too)
	_rt_on = false
	var c: Dictionary = rt_fn.call() if rt_fn.is_valid() else {}
	if not c.is_empty():
		_rt_on = rt.begin(str(c["url"]), str(c.get("key", "")), c.get("headers", PackedStringArray()), c.get("tls", null), mix_rate, peak)
		if _rt_on:
			rt.feed(_rec)

func _rt_stop() -> void:
	if _rt_on:
		rt.cancel()
	_rt_on = false

func _finish_rec() -> void:
	if state != "listening":
		return
	var secs := _rec.size() / mix_rate
	# 1.6.3: too short, or nothing louder than the room noise (a door, the car's motors): forget it quietly
	var pk := 0.0
	for v in _rec:
		pk = maxf(pk, absf(v))
	var mean := 0.0
	for v in _rec:
		mean += v
	mean /= maxf(1.0, _rec.size())
	print("CARPATHRON_TALK heard %.1f s, peak %.3f, dc %.4f, noise %.4f, ptt %s" % [secs, pk, mean, noise, str(_ptt)])
	if secs >= 0.45:
		DirAccess.make_dir_recursive_absolute("user://heard")
		_heard_n = (_heard_n + 1) % 6
		var f := FileAccess.open("user://heard/h%d.wav" % _heard_n, FileAccess.WRITE)
		if f:
			f.store_buffer(_to_wav(_rec))
			f.close()
	if secs >= 0.45 and pk == 0.0:
		print("CARPATHRON_TALK the recording was pure silence (microphone dead): not sent, restarting the microphone")
		_rt_stop()
		_rec = PackedFloat32Array()
		mic_silent.emit()
		_on_reply_missed_silent()
		return
	if secs < 0.45:
		_rt_stop()
		_rec = PackedFloat32Array()
		set_state("idle")
		return
	if _rt_on:
		_rt_on = false
		var rec := _rec
		_rec = PackedFloat32Array()
		set_state("thinking")
		rt.finish(func(text: String, err: String):
			if state != "thinking":
				return
			if err != "" or text == "":
				print("CARPATHRON_RT_ASR fallback (", err if err != "" else "empty", "): sending the recording")
				send_wav(_to_wav(rec))
			else:
				send_text(text))
		return
	send_wav(_to_wav(_rec))
	_rec = PackedFloat32Array()

func _brain() -> String:
	return brain_fn.call() if brain_fn.is_valid() else "pc"

func send_wav(wav: PackedByteArray) -> void:
	set_state("thinking")
	if _brain() == "headset" and local != null:
		local.transcribe(wav, func(text: String, err: String):
			if state != "thinking":
				return
			if err != "":
				_on_reply({"heard": "", "say": "I couldn't hear you through Meta (" + err + ").", "action": "none", "mood": "sorry", "error": err})
			elif text == "":
				_missed()
			else:
				_local_turn(text))
		return
	muse.companion(wav, "", mode_fn.call() if mode_fn.is_valid() else "demo", _on_reply)

## nothing understood: hands-free = just go back to listening (no spoken apology every time a noise is heard);
## push-to-talk = he says so
func _missed() -> void:
	_misses += 1
	if not hands_free or _misses >= 4:
		_misses = 0
		_on_reply({"heard": "", "say": "Sorry, I didn't catch that." + (" Hold the right grip while you talk." if hands_free else ""), "action": "none", "mood": "sorry"})
	else:
		replied.emit({"heard": "", "say": "", "action": "none", "mood": "curious", "missed": true})
		set_state("idle")
		_deaf_until = Time.get_ticks_msec() + 300

var _misses := 0
var _zero_ms := 0.0

## 1.6.8: the headset's microphone input can go dead (only zeros) after the app plays sound: notice it and ask for a
## restart (main.gd recreates the microphone), at most every 3 s
func _mic_watch(ms: float, zero: bool) -> void:
	if not active:
		return
	_zero_ms = _zero_ms + ms if zero else minf(_zero_ms, 0.0)
	if _zero_ms > 800.0:
		print("CARPATHRON_TALK microphone silent for %d ms: restarting it" % int(_zero_ms))
		_zero_ms = -3000.0
		mic_silent.emit()
var _dc := 0.0
var _heard_n := 0

func _on_reply_missed_silent() -> void:
	set_state("thinking")
	_on_reply({"heard": "", "say": "", "action": "none", "mood": "curious", "missed": true})

func send_text(text: String) -> void:
	set_state("thinking")
	if _brain() == "headset" and local != null:
		_local_turn(text)
		return
	muse.companion(PackedByteArray(), text, mode_fn.call() if mode_fn.is_valid() else "demo", _on_reply)

func _local_turn(text: String) -> void:
	var ctx: Dictionary = ctx_fn.call(text) if ctx_fn.is_valid() else {}
	local.turn(text, ctx, func(j: Dictionary):
		j["heard"] = text
		j["local"] = true
		_on_reply(j))

func _on_reply(j: Dictionary) -> void:
	if state != "thinking":
		return   # interrupted meanwhile
	if bool(j.get("missed", false)) and str(j.get("say", "")) == "":
		_missed()
		return
	if str(j.get("heard", "")) != "":
		_misses = 0
	replied.emit(j)
	var au = j.get("audio", [])
	_queue = (au as Array).duplicate() if typeof(au) == TYPE_ARRAY else []
	# no voice files from the PC: the headset's own speech engine says it, sentence by sentence
	if _queue.is_empty() and speech != null and str(speech.ttsStatus()) == "ready" and str(j.get("say", "")) != "":
		var parts: Array = []
		var rx := RegEx.create_from_string("[^.!?…]+[.!?…]*")
		for m in rx.search_all(str(j["say"])):
			var sn := m.get_string().strip_edges()
			if sn == "":
				continue
			if not parts.is_empty() and (str(parts[-1]) + " " + sn).length() < 80:
				parts[-1] = str(parts[-1]) + " " + sn
			else:
				parts.append(sn)
		for p in parts:
			_queue.append({"tts": p})
	if _queue.is_empty():
		set_state("idle")
		_deaf_until = Time.get_ticks_msec() + 300
		return
	set_state("speaking")
	_next_sentence()

func _next_sentence() -> void:
	if _queue.is_empty():
		set_state("idle")
		_deaf_until = Time.get_ticks_msec() + 1200
		return
	var item = _queue.pop_front()
	if typeof(item) == TYPE_DICTIONARY:
		var id := "s%d" % Time.get_ticks_usec()
		var path := str(speech.ttsSay(str(item["tts"]), id, speech_rate))
		if path == "":
			_next_sentence(); return
		_tts_wait = {"id": id, "path": path, "since": Time.get_ticks_msec()}
		return
	var url: String = item
	muse.fetch_audio(url, func(b: PackedByteArray):
		if state != "speaking":
			return
		var st := wav_stream(b)
		if st == null:
			_next_sentence(); return
		player.stream = st
		player.play()
		_play_t = 0.0)

## WAV bytes (PCM 16-bit) -> AudioStreamWAV, and the loudness envelope for the mouth
func wav_stream(b: PackedByteArray) -> AudioStreamWAV:
	if b.size() < 48 or b.slice(0, 4).get_string_from_ascii() != "RIFF":
		return null
	var ch := 1; var rate := 24000; var bits := 16
	var i := 12
	var data := PackedByteArray()
	while i + 8 <= b.size():
		var id := b.slice(i, i + 4).get_string_from_ascii()
		var n := b.decode_u32(i + 4)
		if id == "fmt ":
			ch = b.decode_u16(i + 10); rate = b.decode_u32(i + 12); bits = b.decode_u16(i + 22)
		elif id == "data":
			data = b.slice(i + 8, mini(b.size(), i + 8 + n))
			break
		i += 8 + n + (n & 1)
	if bits != 16 or data.is_empty():
		return null
	var st := AudioStreamWAV.new()
	st.format = AudioStreamWAV.FORMAT_16_BITS
	st.mix_rate = rate
	st.stereo = ch == 2
	st.data = data
	# loudness every 40 ms (every 8th sample is plenty)
	_env = PackedFloat32Array()
	var step := int(rate * 0.04) * 2 * ch
	var k := 0
	while k + step <= data.size():
		var s := 0.0; var c := 0
		var j := k
		while j < k + step:
			var v := data.decode_s16(j) / 32768.0
			s += v * v; c += 1
			j += 16 * ch
		_env.append(clampf(sqrt(s / maxi(1, c)) * 4.0, 0.0, 1.0))
		k += step
	return st

func _play_bytes(b: PackedByteArray) -> void:
	var st := wav_stream(b)
	if st == null:
		_next_sentence(); return
	player.stream = st
	player.play()
	_play_t = 0.0

## Carpathron says something by himself (Muse: a scan summary, he noticed someone) or the headset brain does
func say_now(j: Dictionary) -> void:
	if state != "idle" or not active:
		return
	set_state("thinking")
	_on_reply(j)

func _process(delta: float) -> void:
	if active and muse and state == "idle":
		var cs = muse.state_data.get("companion", {})
		var said = cs.get("say", null) if typeof(cs) == TYPE_DICTIONARY else null
		if typeof(said) == TYPE_DICTIONARY and int(said.get("id", 0)) > _said_id:
			var first := _said_id == 0 and Time.get_ticks_msec() < 15000
			_said_id = int(said["id"])
			if not first and _brain() == "pc":
				say_now({"say": str(said.get("text", "")), "audio": said.get("audio", []), "action": "none", "mood": "excited", "heard": ""})
	# the headset's speech engine finished a sentence file
	if not _tts_wait.is_empty() and speech != null:
		var stt := str(speech.ttsState(_tts_wait["id"]))
		if stt == "done" or stt == "error" or Time.get_ticks_msec() - int(_tts_wait["since"]) > 15000:
			var path: String = _tts_wait["path"]
			_tts_wait = {}
			if state == "speaking" and stt == "done":
				_play_bytes(FileAccess.get_file_as_bytes(path))
				DirAccess.remove_absolute(path)
			elif state == "speaking":
				_next_sentence()
	# speaking: next sentence when this one ends, loudness for the mouth
	if state == "speaking" and player:
		if player.playing:
			_play_t += delta
			var idx := int(_play_t / 0.04)
			level.emit(_env[idx] if idx < _env.size() else 0.0)
		elif player.stream != null and _play_t > 0.05:
			_play_t = 0.0
			player.stream = null
			level.emit(0.0)
			_next_sentence()
	if capture == null:
		return
	var n := capture.get_frames_available()
	if n <= 0:
		_mic_watch(delta * 1000.0, true)
		return
	var buf := capture.get_buffer(n)
	var allz := true
	for i in range(0, buf.size(), 7):
		if buf[i].x != 0.0 or buf[i].y != 0.0:
			allz = false
			break
	_mic_watch(buf.size() / mix_rate * 1000.0, allz)
	var e := 0.0
	var mono := PackedFloat32Array()
	mono.resize(buf.size())
	var sum := 0.0
	for i in buf.size():
		var m := (buf[i].x + buf[i].y) * 0.5
		mono[i] = m
		sum += m
	_dc = lerpf(_dc, sum / maxi(1, buf.size()), 0.05)
	for i in buf.size():
		var d := mono[i] - _dc
		e += d * d
	var rms := sqrt(e / maxi(1, buf.size()))
	peak = maxf(peak * 0.995, rms)
	var ms := buf.size() / mix_rate * 1000.0
	if state == "listening":
		_rec.append_array(mono)
		if _rt_on:
			rt.feed(mono)
		if not _ptt:
			# hands-free: send after 0.8 s of quiet (or 12 s of talking)
			if rms > noise * 2.2 + 0.004:
				_quiet_ms = 0.0; _voice_ms += ms
			else:
				_quiet_ms += ms
			if (_quiet_ms > 800.0 and _voice_ms > 250.0) or _rec.size() > mix_rate * 12.0:
				_finish_rec()
			elif _quiet_ms > 2500.0 and _voice_ms <= 250.0:
				_rt_stop()
				set_state("idle")
		elif _rec.size() > mix_rate * 20.0:
			_finish_rec()
		return
	# not recording: keep a short lead-in, learn the room noise, hands-free notices speech
	_pre.append_array(mono)
	var keep := int(mix_rate * 0.35)
	if _pre.size() > keep:
		_pre = _pre.slice(_pre.size() - keep)
	if state == "idle":
		noise = lerpf(noise, minf(rms, 0.05), 0.02)
		if hands_free and Time.get_ticks_msec() > _deaf_until and rms > noise * 2.5 + 0.005:
			_voice_ms += ms
			if _voice_ms > 120.0:
				_start_rec()
				_voice_ms = 120.0
		else:
			_voice_ms = 0.0

## automated test: "say" something for secs seconds (a tone) through the normal listening path
func test_utterance(secs: float) -> void:
	interrupt()
	_start_rec()
	var x := PackedFloat32Array()
	x.resize(int(mix_rate * secs))
	for i in x.size():
		x[i] = sin(i * 0.05) * 0.2
	_rec.append_array(x)
	if _rt_on:
		rt.feed(x)
	_finish_rec()

## mono float samples at the mix rate -> 16 kHz 16-bit WAV
func _to_wav(x: PackedFloat32Array) -> PackedByteArray:
	var ratio := mix_rate / RATE_OUT
	var n := int(x.size() / ratio)
	# 1.6.7: the headset microphone can carry a constant offset (a "DC" level): it was counted as loud room noise
	# (noise 0.035 in the log) and sent along — remove it first
	var mean := 0.0
	for v in x:
		mean += v
	mean /= maxf(1.0, x.size())
	var pk := 0.0
	for v in x:
		pk = maxf(pk, absf(v - mean))
	var g := clampf(0.9 / maxf(pk, 0.0001), 1.0, 8.0)   # quiet microphones are raised (like Muse does)
	var b := PackedByteArray()
	b.resize(44 + n * 2)
	b.encode_u32(0, 0x46464952); b.encode_u32(4, 36 + n * 2); b.encode_u32(8, 0x45564157)
	b.encode_u32(12, 0x20746d66); b.encode_u32(16, 16); b.encode_u16(20, 1); b.encode_u16(22, 1)
	b.encode_u32(24, RATE_OUT); b.encode_u32(28, RATE_OUT * 2); b.encode_u16(32, 2); b.encode_u16(34, 16)
	b.encode_u32(36, 0x61746164); b.encode_u32(40, n * 2)
	for i in n:
		# average over the samples this one covers (a simple low-pass before taking fewer samples)
		var a := int(i * ratio); var z := mini(x.size(), int((i + 1) * ratio))
		var s := 0.0
		for j in range(a, z):
			s += x[j]
		s = s / maxi(1, z - a) - mean
		b.encode_s16(44 + i * 2, int(clampf(s * g, -1.0, 1.0) * 32767.0))
	return b
