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
signal level(v: float)                       # speaking loudness 0..1 (mouth / eyes)

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

func _ready() -> void:
	mix_rate = AudioServer.get_mix_rate()

func set_state(s: String) -> void:
	if s != state:
		state = s
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
	_queue.clear()
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

func _finish_rec() -> void:
	if state != "listening":
		return
	var secs := _rec.size() / mix_rate
	if secs < 0.45:
		set_state("idle")
		return
	send_wav(_to_wav(_rec))
	_rec = PackedFloat32Array()

func send_wav(wav: PackedByteArray) -> void:
	set_state("thinking")
	muse.companion(wav, "", mode_fn.call() if mode_fn.is_valid() else "demo", _on_reply)

func send_text(text: String) -> void:
	set_state("thinking")
	muse.companion(PackedByteArray(), text, mode_fn.call() if mode_fn.is_valid() else "demo", _on_reply)

func _on_reply(j: Dictionary) -> void:
	if state != "thinking":
		return   # interrupted meanwhile
	replied.emit(j)
	var au = j.get("audio", [])
	_queue = (au as Array).duplicate() if typeof(au) == TYPE_ARRAY else []
	if _queue.is_empty():
		set_state("idle")
		_deaf_until = Time.get_ticks_msec() + 300
		return
	set_state("speaking")
	_next_sentence()

func _next_sentence() -> void:
	if _queue.is_empty():
		set_state("idle")
		_deaf_until = Time.get_ticks_msec() + 450
		return
	var url: String = _queue.pop_front()
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

func _process(delta: float) -> void:
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
		return
	var buf := capture.get_buffer(n)
	var e := 0.0
	var mono := PackedFloat32Array()
	mono.resize(buf.size())
	for i in buf.size():
		var m := (buf[i].x + buf[i].y) * 0.5
		mono[i] = m
		e += m * m
	var rms := sqrt(e / maxi(1, buf.size()))
	var ms := buf.size() / mix_rate * 1000.0
	if state == "listening":
		_rec.append_array(mono)
		if not _ptt:
			# hands-free: send after 0.8 s of quiet (or 12 s of talking)
			if rms > noise * 3.0 + 0.004:
				_quiet_ms = 0.0; _voice_ms += ms
			else:
				_quiet_ms += ms
			if (_quiet_ms > 800.0 and _voice_ms > 250.0) or _rec.size() > mix_rate * 12.0:
				_finish_rec()
			elif _quiet_ms > 2500.0 and _voice_ms <= 250.0:
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
		if hands_free and Time.get_ticks_msec() > _deaf_until and rms > noise * 3.0 + 0.006:
			_voice_ms += ms
			if _voice_ms > 120.0:
				_start_rec()
				_voice_ms = 120.0
		else:
			_voice_ms = 0.0

## mono float samples at the mix rate -> 16 kHz 16-bit WAV
func _to_wav(x: PackedFloat32Array) -> PackedByteArray:
	var ratio := mix_rate / RATE_OUT
	var n := int(x.size() / ratio)
	var pk := 0.0
	for v in x:
		pk = maxf(pk, absf(v))
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
		s /= maxi(1, z - a)
		b.encode_s16(44 + i * 2, int(clampf(s * g, -1.0, 1.0) * 32767.0))
	return b
