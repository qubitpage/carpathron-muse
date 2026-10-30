extends Node3D
## Carpathron Avatar — be the robot (Meta Quest 3S, OpenXR).
## The robot's live camera fills a big screen in front of you. Sticks drive; turn your head and the
## robot turns with you (head steering), so the camera follows your gaze like a robot head.
##
##   Left stick  = left wheels, right stick = right wheels  (tank)   — click right stick: arcade mode
##   A / X       = STOP          B = photo        Y = head steering on/off
##   Trigger     = turbo (100 %)
##   Right grip  = hold and talk to Muse (voice -> Muse Voice Transcribe -> Muse agent: "look left", "scan the room", questions)
##   Left grip   = ask Muse "what do you see?" (Muse Spark looks through the robot's camera)
##   Both grips (hold 1 s) = search robots + Muse PC again      Menu = next robot found

const RobotLink = preload("res://robot_link.gd")
const MuseLink = preload("res://muse_link.gd")
const DemoRobot = preload("res://demo_robot.gd")
const DEAD := 0.15
const TURN_MS_360 := 2400.0   # calibrated full turn of the car at TURN_SPEED (same setting as Muse Carpathron)
const TURN_SPEED := 70.0

var link: Node
var xr_on := false
var origin: XROrigin3D
var cam: Node3D
var left_hand: XRController3D
var right_hand: XRController3D
var pivot: Node3D          # the "robot head": screen + panel, turned when the robot turns
var screen: MeshInstance3D
var screen_mat: StandardMaterial3D
var panel: Label3D
var info: Label3D
var cfg := ConfigFile.new()
var arcade := false
var head_steer := true
var steer_on := false
var placed := false
var prev := {}
var robot_index := 0
var grip_hold := 0.0
var test := {}             # automated test mode (desktop/headless): --test-host=IP [--test-muse=IP:PORT]
var muse: Node
var demo: Node3D = null   # virtual robot when no real robot is on the Wi-Fi
var demo_test := 0
var shots_dir := ""   # --shots=DIR: store screenshots of the demo (desktop render)
var shots_t0 := 0
var rec_effect: AudioEffectRecord
var recording := false
var mic: AudioStreamPlayer = null
var mic_asked := false
var world_env: Environment
var floor_mesh: MeshInstance3D
var screen_title: Label3D

func _ready() -> void:
	cfg.load("user://avatar.cfg")
	head_steer = cfg.get_value("ui", "head_steer", true)
	arcade = cfg.get_value("ui", "arcade", false)
	_build_world()
	link = RobotLink.new()
	add_child(link)
	link.frame.connect(func(t): if demo == null: screen_mat.albedo_texture = t)
	link.changed.connect(_refresh_panel)
	muse = MuseLink.new()
	add_child(muse)
	muse.changed.connect(_on_muse)
	_setup_audio()
	for a in OS.get_cmdline_user_args() + OS.get_cmdline_args():
		if str(a).begins_with("--test-host="):
			test = {"host": str(a).split("=")[1], "t0": Time.get_ticks_msec(), "step": 0}
	for a in OS.get_cmdline_user_args() + OS.get_cmdline_args():
		if str(a).begins_with("--shots="):
			shots_dir = str(a).substr(8)
		if str(a) == "--test-demo":
			demo_test = Time.get_ticks_msec()
		if str(a).begins_with("--test-muse="):
			cfg.set_value("muse", "pc", ""); cfg.set_value("muse", "token", "")
			test["muse"] = str(a).split("=")[1]
	if test:
		link.connect_to(test["host"])
		muse.setup(cfg)
		if test.has("muse"):
			muse.find([test["muse"]])
	else:
		muse.setup(cfg)
		var saved: String = cfg.get_value("robot", "host", "")
		if saved != "":
			link.connect_to(saved)
		else:
			_start_demo()   # something to see and drive at once; a real robot found on the Wi-Fi replaces it
		link.scan(["carpathron.local"] + ([saved] if saved != "" else []))
	_refresh_panel()
	if shots_dir != "":
		_shots_run()

func _build_world() -> void:
	var xri := XRServer.find_interface("OpenXR")
	if xri and xri.is_initialized():
		get_viewport().use_xr = true
		DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED)
		xr_on = true
	var env := WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_COLOR
	e.background_color = Color(0.03, 0.04, 0.06)
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(0.6, 0.6, 0.6)
	env.environment = e
	world_env = e
	add_child(env)
	origin = XROrigin3D.new()
	add_child(origin)
	if xr_on:
		cam = XRCamera3D.new()
		origin.add_child(cam)
		left_hand = XRController3D.new(); left_hand.tracker = "left_hand"; origin.add_child(left_hand)
		right_hand = XRController3D.new(); right_hand.tracker = "right_hand"; origin.add_child(right_hand)
		for h in [left_hand, right_hand]:
			var m := MeshInstance3D.new()
			var bx := BoxMesh.new(); bx.size = Vector3(0.04, 0.03, 0.12)
			m.mesh = bx
			h.add_child(m)
	else:
		var c := Camera3D.new()
		c.position = Vector3(0, 1.6, 0)
		origin.add_child(c)
		cam = c
	# floor grid for a sense of space
	var floor := MeshInstance3D.new()
	var pm := PlaneMesh.new(); pm.size = Vector2(20, 20)
	floor.mesh = pm
	var fm := StandardMaterial3D.new()
	fm.albedo_color = Color(0.08, 0.1, 0.13)
	floor.material_override = fm
	add_child(floor)
	floor_mesh = floor
	pivot = Node3D.new()
	pivot.position = Vector3(0, 1.6, 0)
	add_child(pivot)
	screen = MeshInstance3D.new()
	var q := QuadMesh.new(); q.size = Vector2(3.2, 2.4)    # 4:3 like the ESP32-CAM
	screen.mesh = q
	screen.position = Vector3(0, 0.05, -2.2)
	screen_mat = StandardMaterial3D.new()
	screen_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	screen_mat.albedo_color = Color(1, 1, 1)
	screen.material_override = screen_mat
	screen.layers = 2   # screens and text are not seen by the demo robot's camera
	var bezel := MeshInstance3D.new()
	var bm := BoxMesh.new(); bm.size = Vector3(3.34, 2.54, 0.03)
	bezel.mesh = bm
	var bmat := StandardMaterial3D.new(); bmat.albedo_color = Color(0.08, 0.09, 0.11)
	bezel.material_override = bmat
	bezel.position = Vector3(0, 0, -0.02)
	bezel.layers = 2
	screen.add_child(bezel)
	screen_title = Label3D.new()
	screen_title.text = "ROBOT CAMERA"
	screen_title.font_size = 96
	screen_title.pixel_size = 0.003
	screen_title.position = Vector3(0, 1.5, 0)
	screen_title.modulate = Color(1.0, 0.7, 0.28)
	screen_title.outline_size = 18
	screen_title.outline_modulate = Color(0.05, 0.06, 0.08)
	screen_title.layers = 2
	screen_title.visible = false
	screen.add_child(screen_title)
	pivot.add_child(screen)
	panel = Label3D.new()
	panel.position = Vector3(0, -1.45, -2.1)
	panel.pixel_size = 0.0022
	panel.font_size = 40
	panel.outline_size = 0
	panel.modulate = Color(0.92, 0.93, 0.95)
	panel.width = 1500
	panel.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	panel.layers = 2
	pivot.add_child(panel)
	info = Label3D.new()
	info.position = Vector3(0, 1.35, -2.15)
	info.pixel_size = 0.0025
	info.font_size = 44
	info.modulate = Color(1.0, 0.7, 0.28)
	info.layers = 2
	info.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	info.width = 1400
	pivot.add_child(info)

func _refresh_panel() -> void:
	var l = link
	var who := "no robot yet"
	if demo != null:
		who = "DEMO ROBOT in a virtual room (no real robot found on this Wi-Fi) · Menu = search again"
	elif l.host != "":
		who = "%s @ %s · %s%s" % [l.robot_name if l.robot_name != "" else "robot", l.host, "online" if l.online else "offline", (" · Wi-Fi %d dBm" % l.rssi) if l.rssi != 0 else ""]
	var found := ""
	if l.found.size() > 1:
		found = "\nRobots found: %d — press Menu to switch" % l.found.size()
	panel.text = "CARPATHRON AVATAR · %s%s\n%s · head steering %s · A/X stop · B photo · Y head steering · trigger turbo · hold both grips: search again" % [who, found, "arcade (right stick)" if arcade else "tank (two sticks)", "ON" if head_steer else "off"]
	info.text = demo.tour_text() if demo != null else l.note
	if muse:
		panel.text += "\n" + muse.status_text() + ("   🎤 listening..." if recording else "")
		if muse.last_answer != "":
			if demo != null:
				panel.text += "\nMuse: " + muse.last_answer
			else:
				info.text = muse.last_answer
	if test:
		return
	if demo != null and l.online:
		_stop_demo()
	if l.found.size() > 0 and (l.host == "" or demo != null) and not l.online:
		_stop_demo()
		_pick(0)
	elif demo == null and not l.scanning and l.found.is_empty() and not l.online and l.note.begins_with("No robot"):
		_start_demo()

func _start_demo() -> void:
	if demo != null:
		return
	demo = DemoRobot.new()
	demo.cfg = cfg
	demo.arcade = arcade
	add_child(demo)
	demo.changed.connect(_refresh_panel)
	_place_demo()
	screen_mat.albedo_texture = demo.texture
	link.note = "Demo robot: drive around the virtual room. Press Menu to search for your real robot."
	_demo_layout(true)
	_refresh_panel()

## The demo room is built around you: you stand near the back wall, the robot 1.3 m in front of you.
func _place_demo() -> void:
	if demo == null:
		return
	var yaw := pivot.rotation.y
	var here := Vector3(cam.position.x, 0, cam.position.z) if xr_on and placed else Vector3.ZERO
	demo.rotation.y = yaw
	demo.position = here + Basis(Vector3.UP, yaw) * Vector3(0, 0, -2.6)

## Demo: a small camera screen on the left, the status panel on the right, the tour text above the room.
func _demo_layout(on: bool) -> void:
	floor_mesh.visible = not on
	screen_title.visible = on
	world_env.background_color = Color(0.55, 0.62, 0.7) if on else Color(0.03, 0.04, 0.06)
	world_env.ambient_light_color = Color(0.75, 0.75, 0.78) if on else Color(0.6, 0.6, 0.6)
	if on:
		screen.scale = Vector3(0.34, 0.34, 1)
		screen.position = Vector3(-1.15, -0.1, -1.7)
		screen.rotation_degrees = Vector3(0, 30, 0)
		panel.position = Vector3(1.15, -0.2, -1.7)
		panel.rotation_degrees = Vector3(0, -30, 0)
		panel.pixel_size = 0.0014
		panel.width = 900
		panel.outline_size = 14
		panel.outline_modulate = Color(0.05, 0.06, 0.08, 0.9)
		info.position = Vector3(0, 0.62, -2.3)
		info.pixel_size = 0.0021
		info.outline_size = 16
		info.outline_modulate = Color(0.05, 0.06, 0.08, 0.9)
	else:
		screen.scale = Vector3.ONE
		screen.position = Vector3(0, 0.05, -2.2)
		screen.rotation_degrees = Vector3.ZERO
		panel.position = Vector3(0, -1.45, -2.1)
		panel.rotation_degrees = Vector3.ZERO
		panel.pixel_size = 0.0022
		panel.width = 1500
		panel.outline_size = 0
		info.position = Vector3(0, 1.35, -2.15)
		info.pixel_size = 0.0025
		info.outline_size = 12

func _stop_demo() -> void:
	if demo == null:
		return
	demo.queue_free()
	demo = null
	screen_mat.albedo_texture = null
	_demo_layout(false)

func _on_muse() -> void:
	# Answers are shown on the panel. (No text-to-speech: on Quest without a speech engine Godot's
	# DisplayServer.tts_* calls crash the app — store review VRC.Quest.Functional.1.)
	_refresh_panel()

func _setup_audio() -> void:
	# microphone -> "Record" bus (muted, so you don't hear yourself) with an AudioEffectRecord.
	# The microphone itself starts only when it is first needed and allowed (see _mic_ready).
	var idx := AudioServer.bus_count
	AudioServer.add_bus(idx)
	AudioServer.set_bus_name(idx, "Record")
	AudioServer.set_bus_mute(idx, true)
	rec_effect = AudioEffectRecord.new()
	rec_effect.format = AudioStreamWAV.FORMAT_16_BITS
	AudioServer.add_bus_effect(idx, rec_effect)
	if OS.get_name() == "Android":
		get_tree().on_request_permissions_result.connect(func(perm: String, granted: bool):
			if perm.ends_with("RECORD_AUDIO") and granted:
				_mic_ready())

## True when the microphone runs. On Android the permission is asked the first time push-to-talk is used.
func _mic_ready() -> bool:
	if mic != null:
		return true
	if OS.get_name() == "Android" and not OS.get_granted_permissions().has("android.permission.RECORD_AUDIO"):
		if not mic_asked:
			mic_asked = true
			OS.request_permission("android.permission.RECORD_AUDIO")
			link.note = "Allow the microphone to talk to Muse"
			_refresh_panel()
		return false
	mic = AudioStreamPlayer.new()
	mic.stream = AudioStreamMicrophone.new()
	mic.bus = "Record"
	add_child(mic)
	mic.play()
	return true

func _ptt(down: bool) -> void:
	if down and not recording and muse.state == "linked":
		if not _mic_ready():
			return
		recording = true
		rec_effect.set_recording_active(true)
		_refresh_panel()
	elif not down and recording:
		recording = false
		rec_effect.set_recording_active(false)
		var wav: AudioStreamWAV = rec_effect.get_recording()
		_refresh_panel()
		if wav and wav.data.size() > 4000:
			var f := "user://ptt.wav"
			wav.save_to_wav(f)
			muse.voice(FileAccess.get_file_as_bytes(f))

func _notification(what: int) -> void:
	# Meta menu / headset off / app in background: stop the robot at once
	if what == NOTIFICATION_APPLICATION_FOCUS_OUT or what == NOTIFICATION_APPLICATION_PAUSED or what == NOTIFICATION_WM_CLOSE_REQUEST:
		if link:
			link.stop_now()
		if recording:
			recording = false
			rec_effect.set_recording_active(false)

func _pick(i: int) -> void:
	if link.found.is_empty():
		return
	robot_index = i % link.found.size()
	var h: String = link.found[robot_index]["host"]
	link.connect_to(h)
	cfg.set_value("robot", "host", h)
	cfg.save("user://avatar.cfg")

static func _dz(v: float) -> float:
	return 0.0 if absf(v) < DEAD else (v - signf(v) * DEAD) / (1.0 - DEAD)

func _pressed(name: String, now: bool) -> bool:
	var was: bool = prev.get(name, false)
	prev[name] = now
	return now and not was

func _process(delta: float) -> void:
	if xr_on and not placed and cam.position.y > 0.3:
		pivot.position.y = cam.position.y         # screen at your eye height, in the direction you face at start
		pivot.rotation.y = cam.rotation.y
		placed = true
		_place_demo()
	var ls := Vector2.ZERO
	var rs := Vector2.ZERO
	var stop := false
	var turbo := false
	if xr_on:
		ls = left_hand.get_vector2("primary")
		rs = right_hand.get_vector2("primary")
		stop = left_hand.is_button_pressed("ax_button") or right_hand.is_button_pressed("ax_button")
		turbo = right_hand.get_float("trigger") > 0.5 or left_hand.get_float("trigger") > 0.5
		if _pressed("B", right_hand.is_button_pressed("by_button")):
			if demo != null:
				demo.photo()
			else:
				link.take_photo()
			right_hand.trigger_haptic_pulse("haptic", 0.0, 0.4, 0.08, 0.0)
		if _pressed("Y", left_hand.is_button_pressed("by_button")):
			head_steer = not head_steer
			cfg.set_value("ui", "head_steer", head_steer); cfg.save("user://avatar.cfg")
			link.note = "Head steering " + ("ON" if head_steer else "off")
			if demo != null: demo.event("y")
			_refresh_panel()
		if _pressed("RS", right_hand.is_button_pressed("primary_click")):
			arcade = not arcade
			cfg.set_value("ui", "arcade", arcade); cfg.save("user://avatar.cfg")
			link.note = "Arcade mode (right stick)" if arcade else "Tank mode (two sticks)"
			if demo != null: demo.arcade = arcade
			_refresh_panel()
		if _pressed("LS", left_hand.is_button_pressed("primary_click")) and demo != null:
			demo.event("skip")
		if _pressed("MENU", left_hand.is_button_pressed("menu_button")):
			if demo != null or link.found.is_empty():
				_stop_demo()
				link.scan(["carpathron.local"])
			elif link.found.size() > 1:
				_pick(robot_index + 1)
		var lg := left_hand.get_float("grip") > 0.8
		var rg := right_hand.get_float("grip") > 0.8
		if lg and rg:
			grip_hold += delta
			if recording:
				recording = false; rec_effect.set_recording_active(false)
			if grip_hold > 1.0 and not link.scanning:
				grip_hold = -100.0
				link.scan(["carpathron.local"])
				muse.find([muse.pc] if muse.pc != "" else [])
		else:
			grip_hold = 0.0
			_ptt(rg)
			if _pressed("RG", rg) and demo != null:
				demo.event("talk")
			if _pressed("LG", lg):
				if demo != null:
					demo.event("look")
				muse.ask("What do you see? Anything in the way?")
	if demo_test > 0:
		var dt_ms := Time.get_ticks_msec() - demo_test
		if demo != null and dt_ms < 40000:
			if not test.has("demo_t0"):
				test["demo_t0"] = Time.get_ticks_msec(); test["demo_p0"] = demo.body.position
			var since: int = Time.get_ticks_msec() - test["demo_t0"]
			if since < 1500:
				ls = Vector2(0, 1); rs = Vector2(0, 1)
			elif since > 2000:
				print("DEMO_TEST ", JSON.stringify({"demo": true, "moved_m": demo.body.position.distance_to(test["demo_p0"]), "tex": screen_mat.albedo_texture == demo.texture, "note": link.note}))
				get_tree().quit()
		elif dt_ms > 40000:
			print("DEMO_TEST ", JSON.stringify({"demo": false, "note": link.note, "scanning": link.scanning}))
			get_tree().quit()
	if test.has("host"):
		var r := _test_step()
		ls = r[0]; rs = r[1]; stop = r[2]
	var mx := 100.0 if turbo else 85.0
	var l := 0.0
	var r2 := 0.0
	if arcade:
		l = (_dz(rs.y) + _dz(rs.x)) * mx
		r2 = (_dz(rs.y) - _dz(rs.x)) * mx
	else:
		l = _dz(ls.y) * mx
		r2 = _dz(rs.y) * mx
	# head steering: look >15° away from the screen (sticks idle) and the robot turns towards your gaze
	if head_steer and xr_on and placed and absf(l) < 2 and absf(r2) < 2:
		var off := wrapf(cam.rotation.y - pivot.rotation.y, -PI, PI)   # + = you look left
		var deg := rad_to_deg(off)
		if absf(deg) > 15.0:
			if not steer_on and demo != null:
				demo.event("head")
			steer_on = true
		if absf(deg) < 3.0:
			steer_on = false
		if steer_on:
			var spd := minf(75.0, 45.0 + absf(deg) / 2.0)
			l = -signf(deg) * spd
			r2 = signf(deg) * spd
			var rate := deg_to_rad(360.0 / TURN_MS_360 / (TURN_SPEED / 100.0) * (spd / 100.0) * delta * 1000.0)
			pivot.rotation.y += signf(off) * minf(absf(off), rate)
	if stop:
		if _pressed("STOP", true):
			link.stop_now()
			if demo != null:
				demo.drive(0, 0)
				demo.event("stop")
			link.note = "STOP"; _refresh_panel()
			if xr_on:
				right_hand.trigger_haptic_pulse("haptic", 0.0, 0.7, 0.1, 0.0)
		return
	prev["STOP"] = false
	if demo != null:
		if shots_dir == "":
			demo.drive(int(round(l)), int(round(r2)))
	else:
		link.drive(int(round(l)), int(round(r2)))
	screen_mat.albedo_color = Color(1, 1, 1) if link.online or test or demo != null else Color(0.45, 0.45, 0.45)

# ---- automated test (no headset): connect, wait for video, drive forward 1 s, stop, photo, report, quit
func _test_step() -> Array:
	var t: int = Time.get_ticks_msec() - test["t0"]
	var fwd := Vector2(0, 1)
	if t < 3000:
		return [Vector2.ZERO, Vector2.ZERO, false]
	if t < 4000:
		return [fwd, fwd, false]
	if t < 5000:
		return [Vector2.ZERO, Vector2.ZERO, false]
	if test["step"] == 0:
		test["step"] = 1
		link.take_photo()
	if test.has("muse") and muse.state == "linked" and test["step"] == 1:
		test["step"] = 2
		muse.ask("What do you see?")
	if test.has("muse") and test["step"] == 2 and not muse.busy and muse.last_answer != "" and not muse.last_answer.ends_with("..."):
		test["step"] = 3
		test["answer"] = muse.last_answer
		var w := FileAccess.get_file_as_bytes(OS.get_environment("TEST_WAV"))
		if w.size() > 0:
			muse.voice(w)
	if t > (16000 if test.has("muse") else 8000):
		print("AVATAR_TEST ", JSON.stringify({"frames": link.frames, "online": link.online, "name": link.robot_name, "photo": link.last_photo, "tex": screen_mat.albedo_texture != null, "muse": muse.state, "answer": test.get("answer", ""), "voice": muse.last_answer}))
		get_tree().quit()
	return [Vector2.ZERO, Vector2.ZERO, false]


# ---------------------------------------------------------------- store screenshots (desktop render of the demo tour)
func _wait(sec: float) -> void:
	await get_tree().create_timer(sec).timeout

func _snap(n: String) -> void:
	await RenderingServer.frame_post_draw
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(shots_dir + "/shot" + n + ".png")
	print("SHOT ", n, " step=", demo.step, " pos=", demo.body.position)

## steer the demo robot towards a room point (autopilot for the screenshots)
func _steer_to(target: Vector2, speed := 70.0) -> float:
	var p := Vector2(demo.body.position.x, demo.body.position.z)
	var to := target - p
	var want := atan2(-to.x, -to.y)
	var err := wrapf(want - demo.body.rotation.y, -PI, PI)
	var turn := clampf(err * 120.0, -60.0, 60.0)
	var fw := speed if absf(err) < 0.5 else 0.0
	demo.drive(int(fw - turn), int(fw + turn))
	return to.length()

func _shots_run() -> void:
	await _wait(0.5)
	if demo == null:
		_start_demo()
	demo._enter(0)
	await _wait(1.6)
	await _snap("1")                       # hello wave + step 1
	demo._enter(2)
	demo.drive(60, -60)
	await _wait(1.7)
	demo._enter(3)
	demo.drive(100, 100)
	await _wait(1.2)
	await _snap("2")                       # walking into the room, turbo step
	demo._enter(8)
	var t0 := Time.get_ticks_msec()
	var snapped := false
	while Time.get_ticks_msec() - t0 < 9000 and demo.step == 8:
		_steer_to(demo.TARGET)
		if not snapped and Time.get_ticks_msec() - t0 > 1500:
			snapped = true
			await _snap("3")               # cone course + orange marker
		await get_tree().process_frame
	demo.drive(0, 0)
	# close-up of the robot from the front, photo step
	demo._enter(6)
	var t1 := Time.get_ticks_msec()
	while Time.get_ticks_msec() - t1 < 2500:   # turn to face you
		if _steer_to(Vector2(0, 2.6), 0.0) < 0.0: break
		await get_tree().process_frame
	demo.drive(0, 0)
	await _wait(0.6)
	var fwd: Vector3 = -demo.body.global_transform.basis.z
	cam.position = demo.body.global_position + fwd * 1.25 + Vector3(-0.25, 1.05, 0)
	cam.look_at(demo.body.global_position + Vector3(0, 0.62, 0))
	demo.model.wave(3.0)
	await _wait(1.0)
	await _snap("4")
	cam.position = Vector3(0, 1.6, 0)
	cam.rotation = Vector3.ZERO
	demo._enter(10)
	while Time.get_ticks_msec() - t1 < 9000:   # walk back towards you
		if _steer_to(Vector2(0, 1.3), 60.0) < 0.35: break
		await get_tree().process_frame
	demo.drive(0, 0)
	var t2 := Time.get_ticks_msec()
	while Time.get_ticks_msec() - t2 < 2000:
		_steer_to(Vector2(0, 2.6), 0.0)
		await get_tree().process_frame
	demo.drive(0, 0)
	demo.model.wave(3.0)
	await _wait(1.2)
	await _snap("5")                       # tour complete
	get_tree().quit()
