extends Node3D
## Carpathron Avatar — be the robot (Meta Quest 3 / 3S, OpenXR).
## 1.4: a WELCOME screen at start: "Virtual tour" (3D robot in a virtual room) or one of YOUR ROBOTS found on the
##      Wi-Fi (or known by Muse Carpathron on the PC). A modern menu (Menu button, left controller): point with the
##      laser and pull the trigger, or use a stick + trigger. Quest-style controllers in your hands show what each
##      button does when you look at them. The robot's camera wraps around you (VR view) or plays on a flat screen.
##
##   Sticks      = drive: push forward / back to drive, sideways to turn (either stick). Tank mode in the menu.
##   A / X       = STOP          B = photo        Y = head steering on/off (off by default)
##   Trigger     = turbo (100 %) · in the menu: select
##   Right grip  = hold and talk to Muse          Left grip = ask Muse "what do you see?"
##   Left stick click = missions (explore, scan, measure, find <object>)    Both grips 1 s = search again
##   A dashboard above the picture shows the distance ahead, lean, side eyes and what the car felt (the controllers
##   buzz); the room map is on the left, the controls card on the right.

const RobotLink = preload("res://robot_link.gd")
const MuseLink = preload("res://muse_link.gd")
const DemoRobot = preload("res://demo_robot.gd")
const Cockpit = preload("res://cockpit.gd")
const UiPanel = preload("res://ui_panel.gd")
const ControllerModel = preload("res://controller_model.gd")
const Spectator = preload("res://spectator.gd")
const Vision = preload("res://vision.gd")
const VrView = preload("res://vr_view.gd")
const RoomMode = preload("res://room_mode.gd")
const Talk = preload("res://talk.gd")
const BrainLocal = preload("res://brain_local.gd")
const KeyPage = preload("res://key_page.gd")
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
var tank := false         # 1.4: default = simple driving (a stick: forward/back + turn); tank = one stick per side
var head_steer := false
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
var film := false     # --film: a scripted run for the presentation video (desktop render with --write-movie)
var rec_effect: AudioEffectRecord
var recording := false
var mic: AudioStreamPlayer = null
var mic_asked := false
var world_env: Environment
var floor_mesh: MeshInstance3D
var screen_title: Label3D
var cockpit: Node3D
var menu_rep := 0.0
var menu3d: UiPanel
var ctrl_l: Node3D
var ctrl_r: Node3D
var aim_l: XRController3D
var aim_r: XRController3D
var beams := {}            # hand -> [beam, dot]
var laser_hand := "right"
var welcome_pending := false
var rescan_at := 0
var spectator: Node
var vision: Node
var overlay_quad: MeshInstance3D
var vr: VrView
var view_mode := "vr"      # 1.3: "vr" = the picture all around you, "flat" = the cinema screen
var room: RoomMode = null  # 1.5: Carpathron in my room (mixed reality companion)
var capture: AudioEffectCapture
var robot_talk: Talk       # 1.5: talking with Carpathron while you drive the real car (answers in the headset)
var hands_free := true
var brain: Node            # 1.6: the companion's brain on the headset (Meta API key, no PC needed)
var key_page: Node         # 1.6: put the key in from a phone / PC on this Wi-Fi
var brain_mode := "auto"   # auto | pc | headset
var speech: Object = null  # the headset's speech engine (Android plugin)
var car_seen: Array = []     # 1.6.1: what Baby Carpathron's camera recognised (Muse or the headset brain)
var car_seen_at := 0
var _car_eyes_at := 0
var _noticed := {}
var _notice_at := -100000
var _y_down_at := 0
var _mic_off_at := 0
var cam_win := "medium"    # 1.6.3: the robot's camera window in your room: small / medium / large (it follows your head)
const CAM_WIN := {"small": 0.2, "medium": 0.3, "large": 0.42}
var car_script: Array = [] # 1.6: timed wheel commands for the real car without the PC: [[l, r, ms], ...]
var _car_step_until := 0
var demo_manual := false
var room_test := {}
var room_on_start := false
var room_note := ""        # the only text under your view in "my room" (no robot search messages there)
var _room_log_at := 0        # automated test of "Carpathron in my room" (desktop): --room-test --test-muse=IP:PORT   # training room opened from the menu: stays even when a real robot is online

func _ready() -> void:
	cfg.load("user://avatar.cfg")
	head_steer = cfg.get_value("ui", "head_steer13", false)
	hands_free = cfg.get_value("ui", "hands_free", true)
	cam_win = str(cfg.get_value("ui", "cam_win", "medium"))
	tank = cfg.get_value("ui", "tank14", false)
	view_mode = cfg.get_value("ui", "view", "vr")
	_build_world()
	link = RobotLink.new()
	add_child(link)
	link.frame.connect(func(t): if demo == null: screen_mat.albedo_texture = t)
	link.changed.connect(_refresh_panel)
	link.changed.connect(func(): cockpit.update_dash(link.sensors, link.online))
	link.felt.connect(_on_felt)
	muse = MuseLink.new()
	add_child(muse)
	muse.changed.connect(_on_muse)
	muse.map_changed.connect(func(): cockpit.set_map(muse.map_data))
	# 1.4: what you see goes live to Muse Carpathron (Robots > Live) so the PC screen can be recorded
	spectator = Spectator.new()
	spectator.src = cam
	spectator.muse = muse
	spectator.mode_fn = func(): return "room" if room != null else ("tour" if demo != null else ("robot" if link.host != "" else ""))
	spectator.enabled = cfg.get_value("ui", "share_view", true)
	spectator.bg_fn = func(): return room.view_img if room != null else null
	add_child(spectator)
	vision = Vision.new()
	add_child(vision)
	vr.set_overlay(vision.tex)
	overlay_quad = MeshInstance3D.new()   # the same boxes on the flat screen
	var oq := QuadMesh.new(); oq.size = Vector2(3.2, 2.4)
	overlay_quad.mesh = oq
	var om := StandardMaterial3D.new()
	om.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	om.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	om.albedo_texture = vision.tex
	overlay_quad.material_override = om
	overlay_quad.position = Vector3(0, 0, 0.01)
	overlay_quad.layers = 2
	screen.add_child(overlay_quad)
	brain = BrainLocal.new()
	brain.key = str(cfg.get_value("meta", "key", ""))
	add_child(brain)
	brain_mode = str(cfg.get_value("meta", "brain", "auto"))
	for a in OS.get_cmdline_user_args():   # tests: a local fake Meta API, no PC
		if str(a).begins_with("--meta-base="):
			brain.base = str(a).substr(12)
		if str(a).begins_with("--meta-key="):
			brain.key = str(a).substr(11)
		if str(a) == "--standalone":
			brain_mode = "headset"
	key_page = KeyPage.new()
	add_child(key_page)
	key_page.got_key.connect(_set_key)
	if Engine.has_singleton("CarpathronRoomCam"):
		speech = Engine.get_singleton("CarpathronRoomCam")
		speech.ttsStart()
	_setup_audio()
	for a in OS.get_cmdline_user_args():
		if str(a) == "--room-test":
			room_test = {"t0": Time.get_ticks_msec(), "states": []}
	for a in OS.get_cmdline_user_args() + OS.get_cmdline_args():
		if str(a).begins_with("--test-host="):
			test = {"host": str(a).split("=")[1], "t0": Time.get_ticks_msec(), "step": 0}
	for a in OS.get_cmdline_user_args() + OS.get_cmdline_args():
		if str(a).begins_with("--shots="):
			shots_dir = str(a).substr(8)
		if str(a) == "--film":
			film = true
		if str(a) == "--test-demo":
			demo_test = Time.get_ticks_msec()
		if str(a).begins_with("--test-muse="):
			cfg.set_value("muse", "pc", ""); cfg.set_value("muse", "token", "")
			if room_test:
				room_test["muse"] = str(a).split("=")[1]
			else:
				test["muse"] = str(a).split("=")[1]
	if room_test and OS.get_cmdline_user_args().has("--standalone"):
		muse.setup(cfg)
		_standalone_test_run()
	elif room_test:
		muse.setup(cfg)
		muse.find([room_test["muse"]])
		_room_test_run()
	elif test:
		link.connect_to(test["host"])
		muse.setup(cfg)
		if test.has("muse"):
			muse.find([test["muse"]])
	else:
		muse.setup(cfg)
		var saved: String = cfg.get_value("robot", "host", "")
		_start_demo()             # the virtual room behind the welcome screen
		welcome_pending = true    # 1.4: the welcome screen opens as soon as the headset knows where you look
		for a in OS.get_cmdline_args() + OS.get_cmdline_user_args():
			if str(a) == "--room":   # 1.5: start straight in "Carpathron in my room" (adb: --esa command_line_params --room)
				welcome_pending = false
				room_on_start = true
		link.scan(["carpathron.local"] + ([saved] if saved != "" else []))
	_apply_view()
	_refresh_panel()
	if shots_dir != "":
		_shots_run()
	if film:
		_film_run()
	for a2 in OS.get_cmdline_user_args():
		if str(a2).begins_with("--shot-cockpit="):   # desktop preview: the cockpit with a saved map / state / sensors
			_cockpit_shot(str(a2).substr(15))

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
		left_hand.pose = &"grip"; right_hand.pose = &"grip"
		ctrl_l = ControllerModel.new(false); left_hand.add_child(ctrl_l)
		ctrl_r = ControllerModel.new(true); right_hand.add_child(ctrl_r)
		ctrl_l.set_hints.call_deferred({"stick": "Drive / turn  ·  click: missions", "a": "STOP", "b": "Head steering  ·  HOLD: room / robot view", "menu": "Menu", "trigger": "Turbo  ·  select", "grip": "What do you see?"})
		ctrl_r.set_hints.call_deferred({"stick": "Drive / turn", "a": "STOP", "b": "Photo  ·  back", "trigger": "Turbo  ·  select", "grip": "Hold: talk to Muse"})
		# the laser pointers come from the aim pose (where the controller points)
		aim_l = XRController3D.new(); aim_l.tracker = "left_hand"; aim_l.pose = &"aim"; origin.add_child(aim_l)
		aim_r = XRController3D.new(); aim_r.tracker = "right_hand"; aim_r.pose = &"aim"; origin.add_child(aim_r)
		for pair in [["left", aim_l], ["right", aim_r]]:
			beams[pair[0]] = _make_beam(pair[1])
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
	info.position.y = 1.62
	cockpit = Cockpit.new()
	pivot.add_child(cockpit)
	vr = VrView.new()
	vr.size_name = cfg.get_value("ui", "vr_size", "normal")
	pivot.add_child(vr)
	menu3d = UiPanel.new()
	add_child(menu3d)
	menu3d.provider = _menu_items
	menu3d.chosen.connect(_on_menu)

## a laser beam (thin glowing line) and a dot where it meets the menu
func _make_beam(parent: Node3D) -> Array:
	var bm := StandardMaterial3D.new()
	bm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	bm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	bm.albedo_color = Color(1.0, 0.62, 0.25, 0.75)
	bm.no_depth_test = true
	bm.render_priority = 8
	var beam := MeshInstance3D.new()
	var cm := CylinderMesh.new(); cm.top_radius = 0.0012; cm.bottom_radius = 0.0025; cm.height = 1.0; cm.radial_segments = 8; cm.rings = 1
	beam.mesh = cm
	beam.material_override = bm
	beam.rotation_degrees = Vector3(-90, 0, 0)
	beam.layers = 2
	beam.visible = false
	parent.add_child(beam)
	var dot := MeshInstance3D.new()
	var sm := SphereMesh.new(); sm.radius = 0.008; sm.height = 0.016; sm.radial_segments = 12; sm.rings = 6
	dot.mesh = sm
	var dm := bm.duplicate(); dm.albedo_color = Color(1.0, 0.75, 0.4, 1.0)
	dot.material_override = dm
	dot.layers = 2
	dot.visible = false
	add_child(dot)
	return [beam, dot]

## laser from the hand into the menu; returns true when it points at the menu
func _laser(hand: String, aim: XRController3D, on: bool) -> bool:
	var beam: MeshInstance3D = beams[hand][0]
	var dot: MeshInstance3D = beams[hand][1]
	if not on or not menu3d.is_open:
		beam.visible = false; dot.visible = false
		return false
	var from := aim.global_position
	var dir := -aim.global_basis.z.normalized()
	var hit = menu3d.pointer(from, dir) if hand == laser_hand else null
	var length := 1.2
	if hit != null:
		length = from.distance_to(hit)
		dot.global_position = hit
	dot.visible = hit != null
	beam.visible = true
	beam.scale = Vector3(1, length, 1)
	beam.position = Vector3(0, 0, -length / 2)
	(beam.material_override as StandardMaterial3D).albedo_color.a = 0.8 if hand == laser_hand else 0.25
	return hit != null

## in your room: hold the trigger a little = a beam to the floor, pull it = Carpathron walks there
func _floor_pointer() -> void:
	var aim := aim_r if laser_hand == "right" else aim_l
	var hand := right_hand if laser_hand == "right" else left_hand
	var beam: MeshInstance3D = beams[laser_hand][0]
	var dot: MeshInstance3D = beams[laser_hand][1]
	var tv := hand.get_float("trigger")
	var from := aim.global_position
	var dir := -aim.global_basis.z.normalized()
	if tv < 0.1 or dir.y > -0.05 or room.real:
		beam.visible = false; dot.visible = false
		prev["TAP"] = false
		return
	var t := -from.y / dir.y
	if t > 8.0:
		beam.visible = false; dot.visible = false
		return
	var hit := from + dir * t
	beam.visible = true
	beam.scale = Vector3(1, t, 1)
	beam.position = Vector3(0, 0, -t / 2)
	dot.visible = true
	dot.global_position = hit
	if _pressed("TAP", tv > 0.6):
		room.tap_floor(hit)
		hand.trigger_haptic_pulse("haptic", 0.0, 0.4, 0.06, 0.0)

## an action for the real car when the headset is the brain (with the PC, Muse drives the car itself)
func _car_action(a: String, amount: float) -> void:
	var m := clampf(absf(amount) if amount != 0.0 else 0.5, 0.1, 2.0)
	var deg := clampf(absf(amount) if amount != 0.0 else 90.0, 10.0, 360.0)
	var sp := room.car_speed if room != null else 0.30
	var turn := func(d: float, left: bool) -> Array: return [-70 if left else 70, 70 if left else -70, d / 360.0 * TURN_MS_360]
	match a:
		"stop", "stay": car_script = []; link.stop_now()
		"forward": car_script = [[60, 60, m / sp * 1000.0]]
		"back": car_script = [[-60, -60, m / sp * 1000.0]]
		"left": car_script = [turn.call(deg, true)]
		"right": car_script = [turn.call(deg, false)]
		"spin": car_script = [turn.call(360.0, true)]
		"dance": car_script = [[70, -70, 400], [-70, 70, 400], [70, -70, 400], [-70, 70, 400], [60, 60, 300], [-60, -60, 300]]
		"wave": car_script = [[55, -55, 220], [-55, 55, 220], [55, -55, 220], [-55, 55, 220]]
		_: return
	_car_step_until = 0

## the real car's short moves (standalone brain): one step after the other
func _car_script_step() -> void:
	if car_script.is_empty():
		return
	var now := Time.get_ticks_msec()
	if _car_step_until == 0:
		_car_step_until = now + int(car_script[0][2])
	elif now >= _car_step_until:
		car_script.pop_front()
		_car_step_until = 0 if car_script.is_empty() else now + int(car_script[0][2])

func _refresh_panel() -> void:
	var l = link
	var who := "no robot yet"
	if demo != null:
		who = "TRAINING ROOM (3D demo robot)" + ("" if demo_manual else " · no real robot found on this Wi-Fi yet")
	elif l.host != "":
		who = "%s @ %s · %s%s" % [l.robot_name if l.robot_name != "" else "robot", l.host, "online" if l.online else "offline", (" · Wi-Fi %d dBm" % l.rssi) if l.rssi != 0 else ""]
	var found := ""
	if l.found.size() > 1:
		found = " · %d robots found" % l.found.size()
	panel.text = "CARPATHRON AVATAR " + str(ProjectSettings.get_setting("application/config/version", "")) + " · %s%s\nMENU button (left controller): missions · robots · training room · exit     %s · head steering %s" % [who, found, "tank (two sticks)" if tank else "simple driving", "ON" if head_steer else "off"]
	info.text = demo.tour_text() if demo != null else (room_note if room != null else l.note)
	if muse:
		panel.text += "\n" + muse.status_text() + ("   🎤 listening..." if recording else "")
		if room != null:
			pass
		elif muse.last_answer != "":
			if demo != null:
				panel.text += "\nMuse: " + muse.last_answer
			else:
				info.text = muse.last_answer
	if menu3d:
		menu3d.refresh()
	# 1.4: nothing switches by itself any more: you choose on the welcome screen or in the menu

func _start_demo() -> void:
	if demo != null:
		return
	demo = DemoRobot.new()
	demo.cfg = cfg
	demo.tank = tank
	add_child(demo)
	demo.changed.connect(_refresh_panel)
	demo.bumped.connect(func():
		if xr_on:
			for h in [left_hand, right_hand]:
				h.trigger_haptic_pulse("haptic", 0.0, 0.8, 0.12, 0.0))
	_place_demo()
	screen_mat.albedo_texture = demo.texture
	link.note = "Training room: drive the 3D robot. Menu button: choose your real robot or leave."
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
	if cockpit:
		cockpit.set_demo(on)
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
		info.position = Vector3(0, 1.62, -2.15)
		info.pixel_size = 0.0025
		info.outline_size = 12
	_apply_view()

## VR view (picture all around you, dark, nothing else) or the flat cinema screen. The training room keeps its own layout.
func _apply_view() -> void:
	if vr == null or room != null:
		return
	var on := view_mode == "vr" and demo == null
	vr.visible = on
	screen.visible = not on
	floor_mesh.visible = not on and demo == null
	panel.visible = not on and demo == null
	if demo == null:
		info.position = Vector3(0, -1.0, -1.5) if on else Vector3(0, 1.62, -2.15)
		info.pixel_size = 0.0016 if on else 0.0025
	world_env.background_color = Color(0.0, 0.0, 0.0) if on else (Color(0.55, 0.62, 0.7) if demo != null else Color(0.03, 0.04, 0.06))
	cockpit.set_vr(on)

## 1.5: Carpathron in my room — passthrough, the 3D Carpathron on your real floor, talking, tasks
func _start_room(with_robot := false) -> void:
	if room != null:
		return
	if not with_robot:
		link.stop_now()   # a connected car stays connected but still: the sticks walk the 3D Carpathron
	demo_manual = false
	_stop_demo()
	room = RoomMode.new()
	add_child(room)
	room.real = with_robot
	for a in OS.get_cmdline_user_args():
		if str(a).begins_with("--room-image="):
			room.room_image = str(a).substr(13)
	room.note.connect(func(t):
		if t != "":
			room_note = t
			_refresh_panel())
	_mic_ready()
	_wire_talk(room.talk, _ctx_for)
	room.brain = brain
	room.brain_fn = _brain_now
	room.car_action.connect(_car_action)
	room.begin(muse, cam, capture, hands_free)
	room_note = ("Baby Carpathron: talk to him, he answers here and drives for real" if room.real else "") + ("" if room.passthrough or not xr_on else "  (passthrough is not available on this headset)")
	_room_layout(true)
	_refresh_panel()

## Baby Carpathron: your room with his camera window (mixed reality) <-> only his camera all around you (VR)
func _toggle_robot_view() -> void:
	if room != null:
		_stop_room()
		view_mode = "vr"
		_apply_view()
		link.note = "Robot's eyes: only Baby Carpathron's camera (hold Y for your room again)"
	else:
		_start_room(true)
		room_note = "Your room + Baby Carpathron's camera window (hold Y: only his camera)"
	_refresh_panel()

## where the companion thinks: Muse on the PC, or Meta's models straight from the headset (standalone)
func _brain_now() -> String:
	if brain_mode == "pc":
		return "pc"
	if brain_mode == "headset":
		return "headset"
	if muse.state == "linked" and muse.has_companion():
		return "pc"
	return "headset" if brain.has_key() else "pc"

func _wire_talk(t: Node, ctx: Callable) -> void:
	t.local = brain
	t.brain_fn = _brain_now
	t.ctx_fn = ctx
	t.speech = speech
	t.rt_fn = _rt_cfg

## realtime speech to text: straight to Meta with the headset's key, or through Muse 2.3.3+ (its key)
func _rt_cfg() -> Dictionary:
	# 1.6.5: off unless switched on in Settings (it is not proven on the headset yet; the recording upload is)
	if not bool(cfg.get_value("ui", "fast_listen", false)):
		return {}
	if _brain_now() == "headset" and brain.has_key():
		var u: String = brain.base.replace("https://", "wss://").replace("http://", "ws://") + "/asr/realtime"
		return {"url": u, "key": brain.key, "headers": PackedStringArray(), "tls": null}
	if muse.state == "linked" and muse.token != "" and _ver_at_least(str(muse.version), "2.3.3"):
		return {"url": "wss://" + muse.pc + "/avatar/listen", "key": "", "headers": PackedStringArray(["x-avatar-token: " + muse.token]), "tls": muse._tls}
	return {}

static func _ver_at_least(v: String, want: String) -> bool:
	var a := v.split("."); var b := want.split(".")
	for i in 3:
		var x := int(a[i]) if i < a.size() else 0
		var y := int(b[i]) if i < b.size() else 0
		if x != y:
			return x > y
	return true

## automated tests: one spoken sentence through realtime speech to text
func _rt_test(r: Dictionary) -> void:
	var t: Node = room.talk
	while t.state != "idle":
		await get_tree().create_timer(0.1).timeout
	cfg.set_value("ui", "fast_listen", true)
	r["rt_cfg"] = not _rt_cfg().is_empty()
	var got := {}
	t.replied.connect(func(j): got["j"] = j, CONNECT_ONE_SHOT)
	var t0 := Time.get_ticks_msec()
	t.test_utterance(1.2)
	for i in 150:
		await get_tree().create_timer(0.1).timeout
		if got.has("j"):
			break
	r["rt_heard"] = str(got.get("j", {}).get("heard", ""))
	r["rt_ms"] = Time.get_ticks_msec() - t0

## what the headset brain gets with what you said. With Baby Carpathron connected HE is talking: his camera picture
## (always) and what his camera recognised; otherwise the 3D Carpathron with the headset camera and the room.
func _ctx_for(text: String) -> Dictionary:
	var real_car: bool = demo == null and link.host != "" and (room == null or room.real)
	if not real_car:
		return room.local_ctx(text) if room != null else {"real": false, "objects": []}
	var c := {"real": true, "objects": [], "car_objects": car_seen.map(func(o): return str(o.get("label", "")) + (" (very close)" if bool(o.get("near", false)) else ""))}
	if room != null:
		c["objects"] = room.local_ctx("")["objects"]
	var jpg := _car_jpg()
	if jpg.size() > 0:
		c["jpg"] = jpg
	return c

func _car_jpg() -> PackedByteArray:
	if screen_mat.albedo_texture == null or not link.online:
		return PackedByteArray()
	var im: Image = screen_mat.albedo_texture.get_image()
	return im.save_jpg_to_buffer(0.75) if im else PackedByteArray()

## Baby Carpathron's eyes: to Muse (when the PC does not stream that car itself) or, without the PC, looked at
## by the headset brain; people and pets that come into view get a word from him
func _car_eyes() -> void:
	var real_car: bool = demo == null and link.host != "" and link.online and (room == null or room.real)
	if not real_car:
		car_seen = []
		return
	var now := Time.get_ticks_msec()
	if now < _car_eyes_at:
		return
	if _brain_now() == "pc":
		_car_eyes_at = now + 1200
		if muse.state == "linked" and not link._relay_used:
			muse.post_car(_car_jpg())
		var st: Dictionary = muse.state_data
		if int(st.get("seenAgoMs", -1)) >= 0 and int(st.get("seenAgoMs", -1)) < 8000:
			car_seen = st.get("seen", [])
		return
	_car_eyes_at = now + 2500
	if brain.has_key() and not brain.car_busy:
		var jpg := _car_jpg()
		if jpg.size() == 0:
			return
		brain.car_vision(jpg, func(seen: Array, err: String):
			if err != "":
				return
			car_seen = seen
			car_seen_at = Time.get_ticks_msec()
			for o in seen:
				var k := str(o.get("label", "")).to_lower()
				var kind := str(o.get("kind", ""))
				if (kind == "human" or kind == "animal") and Time.get_ticks_msec() - int(_noticed.get(k, -100000)) > 90000 and Time.get_ticks_msec() - _notice_at > 25000:
					_noticed[k] = Time.get_ticks_msec(); _notice_at = Time.get_ticks_msec()
					var t: Node = room.talk if room != null else robot_talk
					t.say_now({"say": ("Oh, hello! I can see a %s in front of me." if kind == "human" else "Hey, look! There's a %s right here.") % str(o.get("label", "")), "action": "none", "mood": "excited", "heard": "", "local": true})
					break)

static func _visual(text: String) -> bool:
	return RegEx.create_from_string("(?i)\\b(see|look|looking|what'?s (this|that|here|there)|what is (this|that)|colou?r|wearing|holding|show me|how many|read|describe|around|in front|which one|recogni[sz]e|room)\\b").search(text) != null

func _set_key(k: String) -> void:
	brain.key = k.strip_edges()
	cfg.set_value("meta", "key", brain.key); cfg.save("user://avatar.cfg")
	menu3d.fields.erase("apikey")
	link.note = "Meta API key saved in the headset"
	_refresh_panel()
	menu3d.refresh()

func _stop_room() -> void:
	if room == null:
		return
	room.end()
	room.queue_free()
	room = null
	muse.vision_src = "car"
	_room_layout(false)
	_refresh_panel()

func _room_layout(on: bool) -> void:
	cockpit.visible = not on
	if on:
		vr.visible = false
		# with the real car: its camera picture (with the outlined objects) as a small window, low on your right
		screen.visible = room.real
		screen_title.visible = false
		# 1.6.3: the window follows your head (always in view, low on your right); size from the menu
		screen.top_level = true
		screen.scale = Vector3(CAM_WIN.get(cam_win, 0.3), CAM_WIN.get(cam_win, 0.3), 1)
		_cam_win_follow(true)
		panel.visible = false
		floor_mesh.visible = false
		world_env.background_color = Color(0, 0, 0, 0) if room.passthrough else Color(0.16, 0.18, 0.22)
		world_env.ambient_light_color = Color(0.72, 0.72, 0.75)
		info.position = Vector3(0, -0.62, -1.7)
		info.pixel_size = 0.0013
		info.outline_size = 0          # outlined text turns black over passthrough: plain, solid text here
		info.alpha_cut = Label3D.ALPHA_CUT_DISCARD
	else:
		screen_title.visible = false
		info.alpha_cut = Label3D.ALPHA_CUT_DISABLED
		screen.top_level = false
		screen.scale = Vector3.ONE
		screen.position = Vector3(0, 0.05, -2.2)
		screen.rotation_degrees = Vector3.ZERO
		_apply_view()

## the camera window: in front of you, a little low and to the right, turned to your eyes; it glides after your head
func _cam_win_follow(snap := false) -> void:
	if room == null or not room.real or cam == null:
		return
	var f := (-cam.global_basis.z).normalized()
	var right := f.cross(Vector3.UP)
	if right.length() < 0.05:
		return
	right = right.normalized()
	var down := right.cross(f).normalized() * -1.0
	var k: float = CAM_WIN.get(cam_win, 0.3)
	# where you look, a little right and below the centre (so the room and the car stay visible)
	var pos := cam.global_position + f * 1.25 + right * (0.42 - k * 0.5) + down * (0.2 + k * 0.5)
	var t := Transform3D(cam.global_basis.orthonormalized(), pos)   # square to your view, like a screen in your visor
	var sc := screen.scale
	if snap:
		screen.global_transform = t
	else:
		screen.global_transform = screen.global_transform.interpolate_with(t, 0.08)
	screen.scale = sc

func _stop_demo() -> void:
	if demo == null:
		return
	demo.queue_free()
	demo = null
	screen_mat.albedo_texture = null
	_demo_layout(false)

## the car felt something (bump / step / drop / blocked / sensor link lost): warning in front of you + both controllers buzz
func _on_felt(kind: String) -> void:
	cockpit.flash(kind)
	if xr_on:
		var strong := kind != "blocked"
		for h in [left_hand, right_hand]:
			h.trigger_haptic_pulse("haptic", 0.0, 1.0 if strong else 0.5, 0.25 if strong else 0.1, 0.0)

func _on_muse() -> void:
	if muse.state_data:
		cockpit.set_state(muse.state_data)
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
	# 1.5: the companion listens through a capture (push-to-talk and hands-free)
	capture = AudioEffectCapture.new()
	capture.buffer_length = 0.5
	AudioServer.add_bus_effect(idx, capture)
	robot_talk = Talk.new()
	add_child(robot_talk)
	robot_talk.muse = muse
	robot_talk.capture = capture
	robot_talk.player = AudioStreamPlayer.new()
	add_child(robot_talk.player)
	robot_talk.mode_fn = func(): return "real"
	_wire_talk(robot_talk, _ctx_for)
	robot_talk.state_changed.connect(func(st):
		if room == null and demo == null:
			link.note = {"listening": "🎤 listening...", "thinking": "Carpathron is thinking...", "speaking": ""}.get(st, link.note)
			_refresh_panel())
	robot_talk.replied.connect(func(j):
		if bool(j.get("missed", false)):
			muse.last_answer = "🎤 (didn't get that — say it again, or hold the right grip while you talk)"
			_refresh_panel()
			return
		if bool(j.get("local", false)):
			_car_action(str(j.get("action", "none")), float(j.get("amount", 0)))
		muse.last_answer = "You: %s\nCarpathron: %s%s" % [str(j.get("heard", "")), str(j.get("say", "")), ("\nThe car: " + str(j["doing"])) if str(j.get("doing", "")) != "" else ""]
		_refresh_panel())
	if OS.get_name() == "Android":
		get_tree().on_request_permissions_result.connect(func(perm: String, granted: bool):
			if perm.ends_with("RECORD_AUDIO") and granted:
				_mic_ready()
			if room != null:
				room.on_permission(perm, granted))

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

## 1.6.3: with "Talk without buttons" OFF the microphone is open only while you hold the grip, so the Quest's own
## screen recorder can record your voice (two apps cannot share the microphone on the headset)
func _mic_gate(_grip_down: bool) -> void:
	# 1.6.4: the microphone is never stopped and restarted (on the headset the input does not come back reliably);
	# it stays open, and the app only listens hands-free or while you hold the grip
	if mic != null and not mic.playing:
		mic.play()

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

func _toggle_head() -> void:
	head_steer = not head_steer
	cfg.set_value("ui", "head_steer13", head_steer); cfg.save("user://avatar.cfg")
	link.note = "Head steering " + ("ON: the robot turns where you look" if head_steer else "off")
	if demo != null: demo.event("y")
	if not head_steer and xr_on:
		steer_on = false
	_refresh_panel()

func _toggle_tank() -> void:
	tank = not tank
	cfg.set_value("ui", "tank14", tank); cfg.save("user://avatar.cfg")
	link.note = "Tank mode: left stick = left wheels, right stick = right wheels" if tank else "Simple driving: a stick forward / back to drive, sideways to turn"
	if demo != null:
		demo.tank = tank
		demo.event("tank")
	_refresh_panel()

const MISSIONS := ["explore", "scan", "measure", "find", "stop"]

const C_ORANGE := Color(1.0, 0.56, 0.16)
const C_BLUE := Color(0.33, 0.56, 1.0)
const C_GREEN := Color(0.27, 0.8, 0.5)
const C_GREY := Color(0.6, 0.65, 0.73)
const C_RED := Color(0.95, 0.32, 0.32)
const C_PURPLE := Color(0.66, 0.5, 1.0)

func _ver() -> String:
	return str(ProjectSettings.get_setting("application/config/version", ""))

func _chips() -> Array:
	var c: Array = []
	if demo == null and link.host != "":
		c.append([("● " + (link.robot_name if link.robot_name != "" else "robot")) + ("" if link.online else "  offline"), C_GREEN if link.online else C_RED])
	elif demo != null and demo_manual:
		c.append(["● Virtual tour", C_BLUE])
	c.append(["Muse PC  " + str({"linked": "linked", "approve": "click Allow on the PC", "searching": "searching..."}.get(muse.state, "not found")), C_GREEN if muse.state == "linked" else C_GREY])
	return c

func _robot_rows() -> Array:
	var rows: Array = []
	for i in link.found.size():
		var f: Dictionary = link.found[i]
		var here: bool = f["host"] == link.host and demo == null
		var sub := str(f["host"]) + (("   ·   firmware " + str(f["fw"])) if str(f.get("fw", "")) != "" else "") + ("   ·   known by Muse PC" if bool(f.get("muse", false)) else "")
		rows.append({"id": "robot", "arg": str(i), "label": str(f["name"]), "sub": sub, "value": ("Connected" if link.online else "Connecting...") if here else "Connect", "color": C_GREEN})
	return rows

## what each page shows
func _menu_items(p: String) -> Dictionary:
	var its: Array = []
	match p:
		"welcome":
			var n: int = link.found.size()
			var rt := ""
			if link.scanning:
				rt = "Searching on this Wi-Fi...  %d%%" % int(link.scan_progress() * 100)
			elif n > 0:
				rt = "%d robot%s found" % [n, "" if n == 1 else "s"]
			else:
				rt = "None found yet: switch the robot on, same Wi-Fi as the headset"
			return {"layout": "welcome", "title": "Carpathron Avatar", "subtitle": "Be the robot: see through its camera, drive it, give it missions   ·   version " + _ver(),
				"chips": _chips(), "room_text": "Mixed reality: Carpathron stands in YOUR room, sees it, knows the objects in it and talks with you like a friend. Give him tasks by voice.", "tour_text": "Learn every control with the 3D Carpathron robot in a virtual room: driving, turbo, stop, photos, head steering. No robot needed.",
				"robots": _robot_rows(), "robots_text": rt, "robot_first": n > 0,
				"hint": "Point with the controller and pull the trigger   ·   or a stick + trigger   ·   Menu button: the full menu"}
		"missions":
			for it in cockpit.items:
				var ic: String = {"explore": "✦", "scan": "◉", "measure": "↔", "find": "⌖", "stop": "■"}.get(str(it[0]), "•")
				var col: Color = C_RED if it[0] == "stop" else (C_PURPLE if it[0] == "find" else C_ORANGE)
				var sub: String = {"explore": "drives around and maps the room by itself", "scan": "turns around, takes photos and names the objects", "measure": "measures the distances all around", "stop": "stops the car and the mission"}.get(str(it[0]), "drives there on the room map")
				its.append({"id": it[0], "arg": it[1], "icon": ic, "color": col, "label": str(it[2]), "sub": sub})
			its.append({"id": "page", "arg": "main", "icon": "‹", "color": C_GREY, "label": "Back"})
			return {"title": "Missions", "subtitle": "Run by Muse Carpathron on the PC" if muse.state == "linked" else "Needs Muse Carpathron on the PC: open it and allow the headset", "chips": _chips(), "items": its, "parent": "main"}
		"robots":
			its = _robot_rows()
			if link.found.is_empty():
				its.append({"id": "search", "arg": "", "icon": "…", "color": C_GREY, "label": "Searching on this Wi-Fi..." if link.scanning else "No robot found yet", "sub": "Switch the robot on and connect it to the same Wi-Fi as the headset"})
			its.append({"id": "search", "arg": "x", "icon": "⟳", "color": C_BLUE, "label": "Search again", "sub": ("searching...  %d%%" % int(link.scan_progress() * 100)) if link.scanning else "looks on this Wi-Fi and asks Muse on the PC"})
			its.append({"id": "page", "arg": "main", "icon": "‹", "color": C_GREY, "label": "Back"})
			return {"title": "Your robots", "subtitle": "%d found" % link.found.size(), "chips": _chips(), "items": its, "parent": "main"}
		"meta":
			if not key_page.running:
				key_page.start()
			var bn := _brain_now()
			var kv: String = ("set  ✓  ····" + brain.key.right(4)) if brain.has_key() else "not set"
			its.append({"id": "brainmode", "arg": "", "icon": "◎", "color": C_ORANGE, "label": "Carpathron's brain", "sub": "Auto: Muse on the PC when it is linked, otherwise this headset with your key   ·   now: " + ("Muse on the PC" if bn == "pc" else "this headset (standalone)"), "value": {"auto": "Auto", "pc": "Muse PC", "headset": "This headset"}.get(brain_mode, "Auto")})
			its.append({"section": "Meta API key (for the headset on its own)"})
			its.append({"id": "page", "arg": "key", "icon": "⌨", "color": C_BLUE, "label": "Type or paste the key here", "sub": "the Quest keyboard opens", "value": kv})
			if key_page.running and key_page.url() != "":
				its.append({"id": "none", "arg": "", "icon": "📱", "color": C_BLUE, "label": "Or from your phone / PC: " + key_page.url(), "sub": "open it on the same Wi-Fi, code  " + key_page.code + "  — paste the key there", "value": ""})
			if muse.state == "linked":
				its.append({"id": "keyfrommuse", "arg": "", "icon": "⇩", "color": C_GREEN, "label": "Copy the key from Muse Carpathron (this PC)", "sub": "the key saved in Muse on " + muse.pc.split(":")[0] + " (needs Muse 2.3.2)"})
			if brain.has_key():
				its.append({"id": "keytest", "arg": "", "icon": "✓", "color": C_GREEN, "label": "Test the key", "sub": brain.last_error if brain.last_error != "" else "a tiny call to Meta's models"})
				its.append({"id": "keyclear", "arg": "", "icon": "✕", "color": C_RED, "label": "Remove the key from this headset"})
			its.append({"section": "His voice on the headset"})
			var ts := str(speech.ttsStatus()) if speech else "not on this device"
			var eng := str(speech.ttsEngine()) if speech else ""
			its.append({"id": "voicetest", "arg": "", "icon": "♪", "color": C_PURPLE, "label": "Speech engine: " + (("ready  ·  " + eng) if ts == "ready" else ts), "sub": "Without the PC he speaks with the speech engine installed on the Quest. For a natural voice install the free sherpa-onnx Kokoro TTS engine (k2-fsa)." if ts != "ready" else "pull the trigger to hear him", "value": "Test" if ts == "ready" else ""})
			its.append({"id": "page", "arg": "settings", "icon": "‹", "color": C_GREY, "label": "Back"})
			return {"title": "Meta AI", "subtitle": "Use Meta's models straight from the headset — no PC needed", "chips": _chips(), "items": its, "parent": "settings"}
		"key":
			its.append({"field": "apikey", "label": "Meta API key (from Meta's developer site)", "secret": true, "placeholder": "Point here, pull the trigger, type or paste the key"})
			its.append({"id": "keysave", "arg": "", "icon": "✓", "color": C_GREEN, "label": "Save the key"})
			if key_page.running and key_page.url() != "":
				its.append({"id": "none", "arg": "", "icon": "📱", "color": C_BLUE, "label": "Easier: on your phone open " + key_page.url(), "sub": "code  " + key_page.code})
			its.append({"id": "page", "arg": "meta", "icon": "‹", "color": C_GREY, "label": "Back"})
			return {"title": "Meta API key", "subtitle": "Stored only in this headset", "chips": _chips(), "items": its, "parent": "meta"}
		"settings":
			its.append({"id": "page", "arg": "meta", "icon": "✦", "color": C_ORANGE, "label": "Meta AI (use without the PC)", "sub": "API key, where Carpathron thinks, his voice on the headset", "value": "ready" if brain.has_key() else "no key"})
			if demo == null:
				its.append({"id": "view", "arg": "", "icon": "◐", "color": C_BLUE, "label": "View", "sub": "VR: the camera picture all around you   ·   Flat: a cinema screen", "value": "VR" if view_mode == "vr" else "Flat screen"})
				if view_mode == "vr":
					its.append({"id": "vrsize", "arg": "", "icon": "⤢", "color": C_BLUE, "label": "VR picture size", "value": "Large  104°" if vr.size_name == "large" else "Normal  84°"})
			its.append({"id": "drive", "arg": "", "icon": "✥", "color": C_ORANGE, "label": "Driving", "sub": "Simple: a stick forward / back + sideways   ·   Tank: one stick per side", "value": "Tank" if tank else "Simple"})
			its.append({"id": "head", "arg": "", "icon": "◎", "color": C_ORANGE, "label": "Head steering", "sub": "the robot turns where you look", "value": "On" if head_steer else "Off"})
			its.append({"id": "hints", "arg": "", "icon": "?", "color": C_GREY, "label": "Button labels on the controllers", "sub": "shown when you look at your controllers", "value": "On" if cfg.get_value("ui", "hints", true) else "Off"})
			its.append({"id": "handsfree", "arg": "", "icon": "🎤", "color": C_ORANGE, "label": "Talk without buttons", "sub": "On: Carpathron listens when you speak.   Off: hold the right grip while you talk", "value": "On" if hands_free else "Off"})
			its.append({"id": "fastlisten", "arg": "", "icon": "⚡", "color": C_GREY, "label": "Fast listening (beta)", "sub": "your words go to Meta while you talk — test it; if he stops understanding you, switch it off", "value": "On" if bool(cfg.get_value("ui", "fast_listen", false)) else "Off"})
			its.append({"id": "vision", "arg": "", "icon": "◈", "color": C_ORANGE, "label": "Smart vision", "sub": "Muse marks people, animals, obstacles and items on the robot's picture", "value": "On" if cfg.get_value("ui", "vision", true) else "Off"})
			its.append({"id": "share", "arg": "", "icon": "⇪", "color": C_BLUE, "label": "Show my view on the PC", "sub": "Muse Carpathron > Robots > Live shows what you see (to record it)", "value": "On" if spectator.enabled else "Off"})
			its.append({"id": "recenter", "arg": "", "icon": "⊙", "color": C_GREY, "label": "Bring the screen in front of me"})
			its.append({"id": "page", "arg": "main", "icon": "‹", "color": C_GREY, "label": "Back"})
			return {"title": "Settings", "subtitle": "View, driving and controls", "chips": _chips(), "items": its, "parent": "main"}
	if demo == null:
		its.append({"id": "page", "arg": "missions", "icon": "✦", "color": C_ORANGE, "label": "Missions", "sub": "explore, scan, measure, find an object"})
	its.append({"id": "page", "arg": "robots", "icon": "◆", "color": C_GREEN, "label": "Your robots", "sub": "choose a robot on this Wi-Fi", "value": "%d found" % link.found.size()})
	if room != null and room.real:
		its.append({"id": "robotvr", "arg": "", "icon": "◐", "color": C_GREEN, "label": "Only the robot's camera (VR)", "sub": "his camera all around you, no room — e.g. to drive him outside   ·   or hold Y"})
		its.append({"id": "camwin", "arg": "", "icon": "⤢", "color": C_GREEN, "label": "His camera window", "sub": "it follows your head, low on your right", "value": {"small": "Small", "medium": "Medium", "large": "Large"}.get(cam_win, "Medium")})
	elif room == null and demo == null and link.host != "":
		its.append({"id": "robotroom", "arg": "", "icon": "◉", "color": C_GREEN, "label": "My room + the robot's camera (mixed reality)", "sub": "your room with his camera window; talk to Baby Carpathron   ·   or hold Y"})
	its.append({"id": "room", "arg": "", "icon": "◉", "color": C_ORANGE, "label": "Leave my room" if room != null else "Carpathron in my room", "sub": "back to the welcome screen" if room != null else "mixed reality: he stands in your room, sees it and talks with you"})
	its.append({"id": "demo", "arg": "", "icon": "▶", "color": C_BLUE, "label": "Leave the virtual tour" if demo != null else "Virtual tour", "sub": "back to the robots" if demo != null else "the 3D robot in a virtual room: learn and test"})
	its.append({"id": "page", "arg": "settings", "icon": "⚙", "color": C_GREY, "label": "Settings", "sub": "view, driving, head steering, controller labels"})
	its.append({"id": "close", "arg": "", "icon": "✕", "color": C_GREY, "label": "Close the menu"})
	its.append({"id": "exit", "arg": "", "icon": "⏻", "color": C_RED, "label": "Exit Carpathron Avatar"})
	return {"title": "Carpathron Avatar", "subtitle": "Menu   ·   version " + _ver(), "chips": _chips(), "items": its}

func _on_menu(action: String, arg: String) -> void:
	if action in MISSIONS:
		if action == "stop":
			link.stop_now()
		muse.mission(action, arg)
		menu3d.close()
		return
	match action:
		"page":
			menu3d.show_page(arg)
		"room":
			if room != null:
				_stop_room()
				menu3d.open_at(cam, "welcome")
			else:
				_start_room()
				menu3d.close()
		"robotroom":
			_start_room(true)
			menu3d.close()
		"brainmode":
			brain_mode = {"auto": "pc", "pc": "headset", "headset": "auto"}.get(brain_mode, "auto")
			cfg.set_value("meta", "brain", brain_mode); cfg.save("user://avatar.cfg")
			menu3d.refresh()
		"keysave", "field":
			var k := str(menu3d.fields.get("apikey", "")).strip_edges()
			if k.length() > 10:
				_set_key(k)
				menu3d.show_page("meta")
		"keyclear":
			_set_key("")
		"keytest":
			brain.last_error = "testing..."
			menu3d.refresh()
			brain.test_key(func(ok, msg):
				brain.last_error = ("✓ " if ok else "✕ ") + msg
				menu3d.refresh())
		"keyfrommuse":
			muse.get_key(func(k: String, err: String):
				if k != "":
					_set_key(k)
				else:
					link.note = "Muse: " + err
					_refresh_panel()
				menu3d.refresh())
		"voicetest":
			if speech and str(speech.ttsStatus()) == "ready":
				var t: Node = room.talk if room != null else robot_talk
				t.state = "thinking"
				t._on_reply({"say": "Hi! This is my voice on your headset.", "action": "none"})
		"none":
			pass
		"camwin":
			cam_win = {"small": "medium", "medium": "large", "large": "small"}.get(cam_win, "medium")
			cfg.set_value("ui", "cam_win", cam_win); cfg.save("user://avatar.cfg")
			if room != null and room.real:
				screen.scale = Vector3(CAM_WIN[cam_win], CAM_WIN[cam_win], 1)
				_cam_win_follow(true)
			menu3d.refresh()
		"fastlisten":
			cfg.set_value("ui", "fast_listen", not bool(cfg.get_value("ui", "fast_listen", false))); cfg.save("user://avatar.cfg")
			menu3d.refresh()
		"handsfree":
			hands_free = not hands_free
			cfg.set_value("ui", "hands_free", hands_free); cfg.save("user://avatar.cfg")
			if room != null:
				room.talk.hands_free = hands_free
			_mic_gate(false)
			menu3d.refresh()
		"robot":
			demo_manual = false
			_stop_demo()
			_pick(int(arg))
			# 1.5: your real room + the robot's camera window; talk to him, the car does it
			if room != null:
				room.real = true
				_room_layout(true)
			else:
				_start_room(true)
			menu3d.close()
		"robotvr":
			_stop_room()
			menu3d.close()
			_refresh_panel()
		"tour":
			link.stop_now()
			_stop_room()
			demo_manual = true
			if demo == null:
				_start_demo()
			demo._enter(0)
			menu3d.close()
			_refresh_panel()
		"drive":
			_toggle_tank()
			menu3d.refresh()
		"vision":
			cfg.set_value("ui", "vision", not cfg.get_value("ui", "vision", true)); cfg.save("user://avatar.cfg")
			menu3d.refresh()
		"share":
			spectator.enabled = not spectator.enabled
			cfg.set_value("ui", "share_view", spectator.enabled); cfg.save("user://avatar.cfg")
			menu3d.refresh()
		"hints":
			cfg.set_value("ui", "hints", not cfg.get_value("ui", "hints", true)); cfg.save("user://avatar.cfg")
			menu3d.refresh()
		"search":
			_search_all()
			menu3d.refresh()
		"demo":
			_stop_room()
			if demo != null:
				demo_manual = false
				_stop_demo()
				if link.host == "" and not link.found.is_empty():
					_pick(0)
			else:
				link.stop_now()
				demo_manual = true
				_start_demo()
			menu3d.close()
			_refresh_panel()
		"recenter":
			pivot.position = Vector3(cam.position.x, cam.position.y, cam.position.z) if xr_on else pivot.position
			pivot.rotation.y = cam.rotation.y
			_place_demo()
			menu3d.close()
		"view":
			view_mode = "flat" if view_mode == "vr" else "vr"
			cfg.set_value("ui", "view", view_mode); cfg.save("user://avatar.cfg")
			_apply_view()
			menu3d.refresh()
		"vrsize":
			vr.set_size("large" if vr.size_name == "normal" else "normal")
			cfg.set_value("ui", "vr_size", vr.size_name); cfg.save("user://avatar.cfg")
			menu3d.refresh()
		"head":
			_toggle_head()
		"close":
			menu3d.close()
		"exit":
			link.stop_now()
			link.note = "Bye!"
			menu3d.close()
			_refresh_panel()
			await get_tree().create_timer(0.8).timeout   # the 3 stop commands go out first
			get_tree().quit()

## smart vision: the boxes and names Muse found on the live picture (only the real robot, setting on, fresh)
func _vision_update() -> void:
	if test.has("shot"):
		return
	if room != null and not room.real:   # the room's objects are markers in the room (room_mode.gd)
		muse.want_vision = true
		muse.vision_src = "room"
		vision.clear()
		return
	muse.vision_src = "both" if room != null else "car"   # with the real car in "my room": its camera AND the room
	var on: bool = cfg.get_value("ui", "vision", true) and demo == null and link.online and muse.state == "linked"
	if room != null:
		room.car_anchor = screen.global_position + screen.global_basis.y.normalized() * -0.36
	muse.want_vision = on or room != null
	var st: Dictionary = muse.state_data
	if _brain_now() == "headset" and cfg.get_value("ui", "vision", true) and link.online and demo == null:
		if Time.get_ticks_msec() - car_seen_at < 8000 and not car_seen.is_empty():
			vision.show_seen(car_seen, car_seen_at)
		else:
			vision.clear()
		return
	var fresh: bool = on and st.has("seen") and str(st.get("seenSrc", "car")) == "car" and int(st.get("seenAgoMs", -1)) >= 0 and int(st.get("seenAgoMs", -1)) < 7000
	if not fresh:
		vision.clear()
		return
	vision.show_seen(st["seen"], int(st.get("seenAt", 0)))

## look for robots on the Wi-Fi again and ask Muse on the PC
func _search_all() -> void:
	link.scan(["carpathron.local"] + ([link.host] if link.host != "" else []) + ([str(cfg.get_value("robot", "host", ""))] if str(cfg.get_value("robot", "host", "")) != "" else []))
	if muse.state != "linked":
		muse.find([muse.pc] if muse.pc != "" else [])

## background jobs: the robot Muse knows joins the list, a quiet search every 30 s while nothing is connected,
## and the open menu follows the search progress
func _background(_dt: float) -> void:
	# the car's video through Muse when Muse drives this same car (one camera connection = steady picture)
	var car = muse.state_data.get("car", null) if muse else null
	var via := {}
	if typeof(car) == TYPE_DICTIONARY and link.host != "" and str(car.get("ip", "")) == link.host and demo == null:
		via = muse.relay()
	link.set_relay(via)
	_vision_update()
	if test.has("host"):
		test["relay"] = test.get("relay", false) or link._relay_used
	if test:
		return
	if typeof(car) == TYPE_DICTIONARY and str(car.get("ip", "")) != "":
		if link.add_found(str(car["ip"]), str(car.get("name", "Baby Carpathron")), true):
			menu3d.refresh()
	var now := Time.get_ticks_msec()
	if not link.scanning and not link.online and now > rescan_at and (room == null or room.real):
		rescan_at = now + 30000
		if rescan_at > 30000 + 5000:
			_search_all()
	if menu3d.is_open and link.scanning and Engine.get_process_frames() % 30 == 0:
		menu3d.refresh()

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
	if room_on_start and (placed or not xr_on):
		room_on_start = false
		_start_room()
	# 1.5: room status in the Android log every 5 s (adb logcat -s godot)
	if room != null and Time.get_ticks_msec() > _room_log_at:
		_room_log_at = Time.get_ticks_msec() + 5000
		print("CARPATHRON_ROOM ", JSON.stringify({"passthrough": room.passthrough, "camera": room.cam_status, "frames_sent": room.frame_id, "anchors": room.anchors.keys(), "muse": muse.state, "talk": room.talk.state, "hands_free": room.talk.hands_free, "mic": mic != null, "noise": snappedf(room.talk.noise, 0.0001), "cam_luma": snappedf(room.cam_luma, 0.01), "cam": room.cam_index, "cams": room.cam_info, "peak": snappedf(room.talk.peak, 0.001), "muse_version": muse.version, "pc_view": spectator.enabled}))
	if welcome_pending and (placed or not xr_on):
		welcome_pending = false
		menu3d.open_at(cam, "welcome")
	_background(delta)
	if key_page.running and not (menu3d.is_open and menu3d.page in ["meta", "key"]):
		key_page.stop()
	_car_script_step()
	_car_eyes()
	if room != null and room.real and screen.top_level:
		_cam_win_follow()
	robot_talk.active = room == null
	if room != null:
		room.talk.active = true
	info.visible = not menu3d.is_open   # the tour / robot text never shows through an open menu
	var ls := Vector2.ZERO
	var rs := Vector2.ZERO
	var stop := false
	var turbo := false
	if xr_on:
		ls = left_hand.get_vector2("primary")
		rs = right_hand.get_vector2("primary")
		stop = left_hand.is_button_pressed("ax_button") or right_hand.is_button_pressed("ax_button")
		turbo = right_hand.get_float("trigger") > 0.5 or left_hand.get_float("trigger") > 0.5
		var trig_r := right_hand.get_float("trigger") > 0.6
		var trig_l := left_hand.get_float("trigger") > 0.6
		# the controllers in your hands follow your fingers; their labels show when you look at them
		var show_hints: bool = cfg.get_value("ui", "hints", true)
		for c in [[ctrl_l, left_hand], [ctrl_r, right_hand]]:
			var h: XRController3D = c[1]
			c[0].update(h.get_vector2("primary"), h.is_button_pressed("ax_button"), h.is_button_pressed("by_button"), h.is_button_pressed("menu_button"), h.get_float("trigger"), h.get_float("grip"))
			var to_c: Vector3 = (h.global_position - cam.global_position)
			var look := -cam.global_basis.z
			c[0].hints.visible = show_hints and h.get_has_tracking_data() and to_c.length() < 0.7 and look.angle_to(to_c) < deg_to_rad(22)
		if _pressed("MENU", left_hand.is_button_pressed("menu_button")):
			if menu3d.is_open and menu3d.page != "welcome":
				menu3d.close()
			else:
				menu3d.open_at(cam, "main")
			left_hand.trigger_haptic_pulse("haptic", 0.0, 0.3, 0.05, 0.0)
		# the hand whose trigger you pull last is the pointing hand
		if trig_l and not prev.get("TRIG_L", false): laser_hand = "left"
		if trig_r and not prev.get("TRIG_R", false): laser_hand = "right"
		var pointing := _laser("left", aim_l, menu3d.is_open)
		pointing = _laser("right", aim_r, menu3d.is_open) or pointing
		if room != null and not menu3d.is_open:
			_floor_pointer()
		if menu3d.is_open:
			# menu open: point + trigger, or stick + trigger; B / Y back; nothing drives (A / X still STOP)
			if _pressed("B", right_hand.is_button_pressed("by_button")) or _pressed("Y", left_hand.is_button_pressed("by_button")):
				menu3d.back()
			_pressed("LS", left_hand.is_button_pressed("primary_click"))
			_pressed("RS", right_hand.is_button_pressed("primary_click"))
			var st := ls if ls.length() >= rs.length() else rs
			menu_rep -= delta
			if st.length() < 0.5:
				menu_rep = 0.0
			elif menu_rep <= 0.0:
				if absf(st.y) >= absf(st.x):
					menu3d.nav("ui_up" if st.y > 0 else "ui_down")
				else:
					menu3d.nav("ui_right" if st.x > 0 else "ui_left")
				menu_rep = 0.25
				(left_hand if laser_hand == "left" else right_hand).trigger_haptic_pulse("haptic", 0.0, 0.15, 0.02, 0.0)
			var hand_trig := trig_l if laser_hand == "left" else trig_r
			var pressed_now := _pressed("TRIG", hand_trig)
			if pressed_now:
				if pointing:
					menu3d.click(true)
				else:
					menu3d.nav("ui_accept")
				(left_hand if laser_hand == "left" else right_hand).trigger_haptic_pulse("haptic", 0.0, 0.5, 0.05, 0.0)
			elif not hand_trig and prev.get("TRIG_DOWN", false) and pointing:
				menu3d.click(false)
			prev["TRIG_DOWN"] = hand_trig
			ls = Vector2.ZERO; rs = Vector2.ZERO; turbo = false
		else:
			prev["TRIG"] = trig_l or trig_r
			prev["TRIG_DOWN"] = false
			if _pressed("B", right_hand.is_button_pressed("by_button")):
				if demo != null:
					demo.photo()
				else:
					link.take_photo()
				right_hand.trigger_haptic_pulse("haptic", 0.0, 0.4, 0.08, 0.0)
			# Y: short = head steering; HOLD (with Baby Carpathron) = switch "my room + his camera window" <-> "only
			# his camera, all around you" (VR: to drive him somewhere else, e.g. outside)
			var ydown := left_hand.is_button_pressed("by_button")
			if ydown and not prev.get("YH", false):
				_y_down_at = Time.get_ticks_msec()
			if ydown and _y_down_at > 0 and Time.get_ticks_msec() - _y_down_at > 650 and demo == null and link.host != "":
				_y_down_at = 0
				_toggle_robot_view()
				left_hand.trigger_haptic_pulse("haptic", 0.0, 0.6, 0.1, 0.0)
			elif not ydown and prev.get("YH", false) and _y_down_at > 0:
				_y_down_at = 0
				_toggle_head()
			prev["YH"] = ydown
			if _pressed("RS", right_hand.is_button_pressed("primary_click")):
				_toggle_tank()
			if _pressed("LS", left_hand.is_button_pressed("primary_click")):
				if demo != null:
					demo.event("skip")
				else:
					menu3d.open_at(cam, "missions")
					left_hand.trigger_haptic_pulse("haptic", 0.0, 0.3, 0.05, 0.0)
		prev["TRIG_L"] = trig_l
		prev["TRIG_R"] = trig_r
		var lg := left_hand.get_float("grip") > 0.8 and not menu3d.is_open
		var rg := right_hand.get_float("grip") > 0.8 and not menu3d.is_open
		if lg and rg:
			grip_hold += delta
			if recording:
				recording = false; rec_effect.set_recording_active(false)
			if grip_hold > 1.0 and not link.scanning:
				grip_hold = -100.0
				_search_all()
		else:
			grip_hold = 0.0
			# 1.5: the right grip talks to Carpathron (in your room, or while driving the real car: he answers in the
			# headset and the car does the tasks); squeezing it while he speaks interrupts him
			if room != null:
				if not rg or _mic_ready():
					room.talk.ptt(rg)
			elif demo == null and link.host != "" and not test.has("host"):
				if not rg or _mic_ready():
					robot_talk.ptt(rg)
			else:
				_ptt(rg)
			_mic_gate(rg)
			if _pressed("RG", rg) and demo != null:
				demo.event("talk")
			if _pressed("LG", lg):
				if room != null:
					room.talk.send_text("What do you see in my room right now?")
				elif demo == null and link.host != "" and not test.has("host"):
					robot_talk.send_text("What do you see? Anything in the way?")
				else:
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
	if tank:
		l = _dz(ls.y) * mx
		r2 = _dz(rs.y) * mx
	else:
		# simple driving: either stick, forward / back drives, sideways turns (gentle turns while driving)
		var fy := clampf(_dz(ls.y) + _dz(rs.y), -1.0, 1.0)
		var tx := clampf(_dz(ls.x) + _dz(rs.x), -1.0, 1.0)
		var tg := 0.75 if absf(fy) < 0.1 else 0.5
		var lw := fy + tx * tg
		var rw := fy - tx * tg
		var big := maxf(1.0, maxf(absf(lw), absf(rw)))
		l = lw / big * mx
		r2 = rw / big * mx
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
			if muse.state == "linked" and muse.state_data.get("busy", null) != null:
				muse.mission("stop")
			if demo != null:
				demo.drive(0, 0)
				demo.event("stop")
			if room != null:
				room.do_action("stop", "", 0.0)
				room.nav_stop("STOP")
				room.talk.interrupt()
			link.note = "STOP"; _refresh_panel()
			if xr_on:
				right_hand.trigger_haptic_pulse("haptic", 0.0, 0.7, 0.1, 0.0)
		return
	prev["STOP"] = false
	if demo != null:
		if shots_dir == "" and not film:
			demo.drive(int(round(l)), int(round(r2)))
	elif room != null and not room.real:
		room.manual((l + r2) / 200.0, (r2 - l) / 200.0)
	elif not car_script.is_empty() and absf(l) < 5 and absf(r2) < 5:
		link.drive(int(car_script[0][0]), int(car_script[0][1]))
	elif room != null and room.nav_active():
		if absf(l) > 5 or absf(r2) > 5:
			room.nav_stop("you took the sticks")
			link.drive(int(round(l)), int(round(r2)))
		else:
			var wv: Vector2 = room.nav_wheels()
			link.drive(int(wv.x), int(wv.y))
	else:
		link.drive(int(round(l)), int(round(r2)))
	robot_talk.capture = capture if room == null and demo == null and link.host != "" else null
	if room != null and room.real:
		screen_mat.albedo_color = Color(1, 1, 1) if link.online else Color(0.45, 0.45, 0.45)
	robot_talk.hands_free = hands_free and link.online
	screen_mat.albedo_color = Color(1, 1, 1) if link.online or test or demo != null else Color(0.45, 0.45, 0.45)
	if vr.visible:
		vr.sync(screen_mat.albedo_texture, screen_mat.albedo_color)

# ---- automated test (no headset): connect, wait for video, drive forward 1 s, stop, photo, report, quit
func _test_step() -> Array:
	var t: int = Time.get_ticks_msec() - test["t0"]
	var fwd := Vector2(0, 1)
	if not test.has("felt"):
		test["felt"] = []
		link.felt.connect(func(k): test["felt"].append(k))

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
	if test.has("muse") and test["step"] == 3 and not test.has("mission") and muse.last_answer.contains("Look"):
		test["mission"] = true
		test["voice"] = muse.last_answer
		muse.mission("explore")   # 1.2: a mission from the headset, run by Muse on the PC
	if test.has("muse") and test["step"] == 2 and not muse.busy and muse.last_answer != "" and not muse.last_answer.ends_with("..."):
		test["step"] = 3
		test["answer"] = muse.last_answer
		var w := FileAccess.get_file_as_bytes(OS.get_environment("TEST_WAV"))
		if w.size() > 0:
			muse.voice(w)
	if t > (20000 if test.has("muse") else 8000):
		print("AVATAR_TEST ", JSON.stringify({"frames": link.frames, "online": link.online, "name": link.robot_name, "photo": link.last_photo, "tex": screen_mat.albedo_texture != null, "muse": muse.state, "answer": test.get("answer", ""), "voice": test.get("voice", muse.last_answer), "mission": muse.last_answer,
			"dash": cockpit.dash.text, "felt": test.get("felt", []), "warn": cockpit.warn.text, "state": muse.state_data.keys(), "map": muse.map_data.keys(), "menu": cockpit.items.size(), "news": cockpit.news.text, "relay": test.get("relay", false), "frames_relay": link.frames, "seen": (muse.state_data.get("seen", []) as Array).map(func(o): return o["label"]), "vision_labels": vision.root.get_child_count()}))
		get_tree().quit()
	return [Vector2.ZERO, Vector2.ZERO, false]


# ---------------------------------------------------------------- store screenshots (desktop render of the demo tour)
## "Carpathron in my room" end to end (no headset): link to Muse, the room picture -> objects recognised -> markers,
## talk ("look at the chair" -> he walks to it), a quick command (dance), the PC view, a screenshot
func _room_test_run() -> void:
	var r := {}
	for i in 200:
		await get_tree().create_timer(0.1).timeout
		if muse.state == "linked":
			break
	r["linked"] = muse.state == "linked"
	cam.rotation_degrees.x = -32.0    # in the headset you look down at him
	_start_room()
	room.talk.state_changed.connect(func(st): room_test["states"].append(st))
	for i in 250:
		await get_tree().create_timer(0.1).timeout
		if room.anchors.has("chair"):
			break
	r["anchors"] = room.anchors.keys()
	var chair = room.find_anchor("chair")
	var d0 := -1.0
	if chair != null:
		d0 = room._floor(room.body.global_position).distance_to(room._floor(chair["pos"]))
	room.talk.send_text("could you take a look at the chair for me")
	for i in 300:
		await get_tree().create_timer(0.1).timeout
		if room.behaviour == "idle" and room.bubble.text.contains("chair") and room.talk.state != "thinking":
			break
	r["say"] = room.bubble.text
	r["mood"] = room.mood
	if chair != null:
		r["chair_before"] = d0
		r["chair_after"] = room._floor(room.body.global_position).distance_to(room._floor(chair["pos"]))
	room.talk.send_text("dance")
	for i in 100:
		await get_tree().create_timer(0.1).timeout
		if room.dance_t > 0.0:
			break
	r["danced"] = room.dance_t > 0.0
	r["quick_say"] = room.bubble.text
	await get_tree().create_timer(1.5).timeout
	r["view_bg"] = room.view_tex != null
	# guided driving (simulated car seen by the headset): unknown heading, real speed 0.42 m/s (not the guess 0.30)
	if OS.get_cmdline_user_args().has("--nav-sim"):
		room.real = true
		room.sim_car = {"pos": Vector3(0.8, 0, -1.6), "yaw": 2.2, "speed": 0.42, "next": 0}
		var goal := Vector3(-0.9, 0, -2.4)
		room.nav_start(goal, "chair")
		var t0 := Time.get_ticks_msec()
		while room.nav_active() and Time.get_ticks_msec() - t0 < 40000:
			await get_tree().create_timer(0.1).timeout
		r["nav_dist"] = (room.sim_car["pos"] as Vector3).distance_to(goal)
		r["nav_secs"] = (Time.get_ticks_msec() - t0) / 1000.0
		r["nav_speed_learned"] = room.car_speed
		r["nav_say"] = room.bubble.text
		room.sim_car = {}
		room.real = false
	# with the real car (--test-car=IP:PORT): pick it -> mixed reality with its camera window; talk -> it drives
	for a in OS.get_cmdline_user_args():
		if str(a).begins_with("--test-car="):
			link.found = [{"host": str(a).substr(11), "name": "Baby Carpathron", "key": "car"}]
			_on_menu("robot", "0")
			for i in 100:
				await get_tree().create_timer(0.1).timeout
				if link.online and link.frames > 3:
					break
			r["real"] = room.real
			r["car_online"] = link.online
			r["car_window"] = screen.visible and not room.model.visible
			room.talk.send_text("drive forward a bit")
			for i in 200:
				await get_tree().create_timer(0.1).timeout
				if room.talk.state != "thinking" and room.bubble.text.contains("forward"):
					break
			r["real_say"] = room.bubble.text
			await get_tree().create_timer(2.0).timeout
	await _rt_test(r)
	r["states"] = room_test["states"]
	r["camera"] = room.cam_status
	r["frames_sent"] = room.frame_id
	var shot := ""
	for a in OS.get_cmdline_user_args():
		if str(a).begins_with("--room-shot="):
			shot = str(a).substr(12)
	if shot != "":
		await RenderingServer.frame_post_draw
		get_viewport().get_texture().get_image().save_png(shot)
		var sv: Image = spectator.vp.get_texture().get_image()
		if sv:
			sv.save_png(shot.replace(".png", "-pc.png"))
	print("ROOM_TEST ", JSON.stringify(r))
	get_tree().quit()

## standalone (no PC): the headset brain looks at the room, talks, hears a WAV, and drives the real car
func _standalone_test_run() -> void:
	var r := {"brain": _brain_now()}
	cam.rotation_degrees.x = -32.0
	_start_room()
	room.talk.state_changed.connect(func(st): room_test["states"].append(st))
	for i in 250:
		await get_tree().create_timer(0.1).timeout
		if room.anchors.has("chair"):
			break
	r["anchors"] = room.anchors.keys()
	var chair = room.find_anchor("chair")
	var d0: float = room._floor(room.body.global_position).distance_to(room._floor(chair["pos"])) if chair != null else -1.0
	room.talk.send_text("could you take a look at the chair for me")
	for i in 300:
		await get_tree().create_timer(0.1).timeout
		if room.behaviour == "idle" and room.bubble.text.contains("chair") and room.talk.state != "thinking":
			break
	r["say"] = room.bubble.text
	if chair != null:
		r["chair_before"] = d0
		r["chair_after"] = room._floor(room.body.global_position).distance_to(room._floor(chair["pos"]))
	# a spoken sentence (WAV) -> Meta transcription -> the answer
	var n := 24000
	var w := PackedByteArray(); w.resize(44 + n * 2)
	w.encode_u32(0, 0x46464952); w.encode_u32(4, 36 + n * 2); w.encode_u32(8, 0x45564157); w.encode_u32(12, 0x20746d66)
	w.encode_u32(16, 16); w.encode_u16(20, 1); w.encode_u16(22, 1); w.encode_u32(24, 16000); w.encode_u32(28, 32000); w.encode_u16(32, 2); w.encode_u16(34, 16)
	w.encode_u32(36, 0x61746164); w.encode_u32(40, n * 2)
	var heard := {}
	room.talk.replied.connect(func(j): heard["j"] = j, CONNECT_ONE_SHOT)
	room.talk.send_wav(w)
	for i in 200:
		await get_tree().create_timer(0.1).timeout
		if heard.has("j"):
			break
	r["heard"] = str(heard.get("j", {}).get("heard", ""))
	r["voice_say"] = str(heard.get("j", {}).get("say", ""))
	for a in OS.get_cmdline_user_args():
		if str(a).begins_with("--test-car="):
			link.found = [{"host": str(a).substr(11), "name": "Baby Carpathron", "key": "car"}]
			_on_menu("robot", "0")
			for i in 100:
				await get_tree().create_timer(0.1).timeout
				if link.online:
					break
			r["car_online"] = link.online
			# he looks through his own camera (headset brain) and speaks up when he sees someone
			for i in 120:
				await get_tree().create_timer(0.1).timeout
				if room.bubble.text.contains("I can see") or room.bubble.text.contains("There's a"):
					break
			r["notice"] = room.bubble.text
			r["car_seen"] = car_seen.map(func(o): return o["label"])
			while room.talk.state != "idle":
				await get_tree().create_timer(0.1).timeout
			room.talk.send_text("drive forward a bit")
			for i in 200:
				await get_tree().create_timer(0.1).timeout
				if not car_script.is_empty():
					break
			r["car_script"] = car_script.size()
			await get_tree().create_timer(2.0).timeout
	await _rt_test(r)
	r["states"] = room_test["states"]
	print("STANDALONE_TEST ", JSON.stringify(r))
	get_tree().quit()

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

## presentation video: welcome screen -> virtual tour -> driving through the cones -> through the robot's eyes ->
## the menu -> goodbye. Run: godot --path . --write-movie film.avi --fixed-fps 30 --resolution 1920x1080 -- --film
func _film_cam(pos: Vector3, look: Vector3, k := 1.0) -> void:
	var t := Transform3D(Basis(), pos).looking_at(look, Vector3.UP)
	cam.global_transform = cam.global_transform.interpolate_with(t, k)

func _film_run() -> void:
	if demo:
		demo._enter(0)
	(cam as Camera3D).fov = 68
	cam.position = Vector3(0, 1.6, 0)
	await _wait(0.4)
	# 1. welcome screen, focus moves over the choices
	_film_cam(Vector3(0, 1.5, -0.3), Vector3(0, 1.42, -1.35))
	await _wait(1.6)
	for a in ["ui_right", "ui_down", "ui_left"]:
		menu3d.nav(a)
		await _wait(0.9)
	# 2. the virtual tour: the robot waves hello
	_on_menu("tour", "")
	demo.model.wave(3.0)
	await _wait(2.8)
	# 3. driving through the cones to the orange crate (seen from where you stand)
	demo._enter(8)
	var t0 := 0
	while t0 < 270 and demo.step == 8:
		_steer_to(demo.TARGET, 80.0)
		var bp: Vector3 = demo.body.global_position
		_film_cam(Vector3(bp.x * 0.4, 1.35, bp.z + 2.2), bp + Vector3(0, 0.4, 0), 0.08)
		await get_tree().process_frame
		t0 += 1
	demo.drive(0, 0)
	# 4. through the robot's eyes: what its camera sees while it drives around the room
	(cam as Camera3D).cull_mask = 1
	(cam as Camera3D).fov = 62
	var pts := [Vector2(-1.5, -2.6), Vector2(-2.6, 0.4), Vector2(0.4, 1.4), Vector2(2.6, -0.6)]
	for target in pts:
		var t1 := 0
		while t1 < 96:
			if _steer_to(target, 75.0) < 0.5:
				break
			cam.global_transform = demo.cam.global_transform
			await get_tree().process_frame
			t1 += 1
	demo.drive(0, 0)
	(cam as Camera3D).cull_mask = 0xFFFFF
	(cam as Camera3D).fov = 68
	# 5. the menu: missions, your robots, settings
	cam.global_transform = Transform3D(Basis(), Vector3(0, 1.6, 0))
	_film_cam(Vector3(0, 1.5, -0.3), Vector3(0, 1.42, -1.35))
	menu3d.open_at(cam, "main")
	await _wait(1.4)
	for a in ["ui_down", "ui_down", "ui_down"]:
		menu3d.nav(a)
		await _wait(0.6)
	menu3d.show_page("settings")
	await _wait(2.4)
	menu3d.close()
	# 6. goodbye: the robot comes back and waves
	var t2 := 0
	while t2 < 120:
		if _steer_to(Vector2(0, 1.25), 70.0) < 0.35:
			break
		await get_tree().process_frame
		t2 += 1
	var t3 := 0
	while t3 < 45:
		_steer_to(Vector2(0, 2.6), 0.0)
		await get_tree().process_frame
		t3 += 1
	demo.drive(0, 0)
	demo.model.wave(3.0)
	var rp: Vector3 = demo.body.global_position
	_film_cam(rp + (cam.global_position - rp).normalized() * 1.3 + Vector3(0, -0.4, 0), rp + Vector3(0, 0.75, 0))
	await _wait(3.0)
	get_tree().quit()

func _cockpit_shot(spec: String) -> void:
	var parts := spec.split(",")   # json,png[,vr|flat|menu|robots|missions]
	var mode := parts[2] if parts.size() > 2 else "vr"
	var j = JSON.parse_string(FileAccess.get_file_as_string(parts[0]))
	test = {"shot": true}   # no demo, no robot search while the picture is taken
	welcome_pending = false
	_stop_demo()
	link.host = ""; link.online = true; link.robot_name = "Baby Carpathron"
	var img := Image.load_from_file(parts[0].get_base_dir() + "/cam.jpg") if FileAccess.file_exists(parts[0].get_base_dir() + "/cam.jpg") else null
	if img:
		screen_mat.albedo_texture = ImageTexture.create_from_image(img)
	cockpit.set_map(j["map"]); cockpit.set_state(j["state"])
	link.sensors = j["sensors"]
	cockpit.update_dash(j["sensors"], true)
	if mode in ["vr", "flat"]:
		cockpit.flash("bump")
	link.found = [{"host": "192.168.1.131", "name": "Baby Carpathron", "key": "192.168.1.131"}, {"host": "192.168.1.140", "name": "Carpathron Brain", "key": "192.168.1.140"}]
	link.note = "Connected to Baby Carpathron"
	view_mode = "flat" if mode == "flat" else "vr"
	_apply_view()
	var seen: Array = j.get("seen", [{"label": "person", "kind": "human", "box": [0.12, 0.1, 0.22, 0.75], "near": false}, {"label": "chair", "kind": "furniture", "box": [0.55, 0.45, 0.3, 0.45], "near": true}])
	vision.show_seen(seen, 1)
	_refresh_panel()
	cam.position = Vector3(0, 1.6, 0)
	(cam as Camera3D).fov = 100 if mode in ["vr", "flat"] else 66
	if mode in ["menu", "robots", "missions", "settings", "welcome", "meta", "key"]:
		menu3d.open_at(cam, "main" if mode == "menu" else mode)
	if mode == "welcome":
		_start_demo()
		cam.position = Vector3(0, 1.6, 0)
	await _wait(0.8)
	vr.sync(screen_mat.albedo_texture, screen_mat.albedo_color)
	await RenderingServer.frame_post_draw
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(parts[1])
	print("COCKPIT_SHOT ", parts[1])
	get_tree().quit()
