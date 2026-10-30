extends Node3D
## Demo robot + guided tour, used when no real robot is on the Wi-Fi (and by store reviewers).
## The 3D Carpathron robot stands in a virtual room around you. You drive it with exactly the same controls
## as a real robot (tank wheel speeds -100..100) and its head camera feeds the camera screen, like the real
## robot's live video. A step-by-step tour teaches every control, so you know them before you connect a robot.
## Room coordinates: you stand at (0, 0, 2.6) looking towards -Z; main.gd places this node around you.

signal changed

const RobotModel = preload("res://robot_model.gd")
const MAX_SPEED := 0.7        # m/s at 100 %
const TRACK := 0.16           # wheel distance of the real car, m (same turning feel)
const RADIUS := 0.22          # robot footprint
const PLAYER := Vector2(0, 2.6)
const TARGET := Vector2(1.6, -1.75)   # in front of the orange crate

const STEPS := [
	"Hi, I'm Carpathron! I'll teach you how to drive me.\nPush BOTH sticks forward: I walk towards you.",
	"Great! Now pull BOTH sticks back: I walk backwards.",
	"Spin me around: LEFT stick forward + RIGHT stick back.\n(Tank mode: each stick drives one side of the robot.)",
	"Hold a TRIGGER while you drive: TURBO, full speed!",
	"Press A or X: STOP at once. You can always stop me this way.",
	"Head steering: look left or right and I turn where you look.\nPress Y to switch head steering on or off.",
	"Press B to take a photo with my camera.\nThe screen on your left shows what I see.",
	"Click the RIGHT stick: ARCADE mode.\nThen drive with the right stick alone: up = forward, sideways = turn.",
	"Now drive me through the cones to the orange crate.\nFollow the orange marker! (Click the right stick again for tank mode.)",
	"Voice: hold the RIGHT grip and speak, e.g. \"look left\", \"scan the room\".\nLEFT grip asks \"what do you see?\". Squeeze a grip to try it.\n(Voice needs the Carpathron PC app on your Wi-Fi.)",
	"Tour complete! A real Carpathron robot drives exactly the same way.\nMenu = search for your robot   ·   Left stick click = replay the tour",
]
const LAST := 10

var texture: Texture2D
var vp: SubViewport
var cam: Camera3D
var body: Node3D          # the robot: position / heading in the room
var model: Node3D
var marker: Node3D
var l := 0.0
var r := 0.0
var arcade := false
var cfg: ConfigFile
var step := 0
var acc := {}
var obstacles := []      # [center: Vector2, half size: Vector2]
var photos := 0
var note := ""           # short feedback line ("Photo saved", ...)
var note_t := 0.0
var step_t := 0.0

func _ready() -> void:
	if cfg:
		step = int(cfg.get_value("demo", "step", 0))
		if step >= LAST:
			step = LAST
	_build_room()
	body = Node3D.new()
	body.position = Vector3(0, 0, 1.0)
	body.rotation.y = PI          # facing you, to say hello
	add_child(body)
	model = RobotModel.new()
	body.add_child(model)
	# the robot camera sits in its visor; it renders this room (not the screens, they are on layer 2)
	vp = SubViewport.new()
	vp.size = Vector2i(800, 600)
	vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	add_child(vp)
	cam = Camera3D.new()
	cam.fov = 62.0
	cam.cull_mask = 1
	cam.near = 0.05
	vp.add_child(cam)
	texture = vp.get_texture()
	marker = Node3D.new()
	var mk := MeshInstance3D.new()
	var pm := PrismMesh.new(); pm.size = Vector3(0.22, 0.26, 0.22)
	mk.mesh = pm
	mk.rotation_degrees = Vector3(180, 0, 0)
	var mm := StandardMaterial3D.new(); mm.albedo_color = Color(1, 0.5, 0.12); mm.emission_enabled = true
	mm.emission = Color(1, 0.45, 0.1); mm.emission_energy_multiplier = 1.5
	mk.material_override = mm
	marker.add_child(mk)
	marker.position = Vector3(TARGET.x, 1.0, TARGET.y)
	add_child(marker)
	_enter(step)

func _build_room() -> void:
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-55, 35, 0)
	sun.light_energy = 0.9
	add_child(sun)
	# room 8 x 8 m: wooden floor, walls, a rug, furniture and toys in brand colours
	_box(Vector3(0, -0.05, 0), Vector3(8, 0.1, 8), Color(0.55, 0.42, 0.3))
	for w in [[Vector3(0, 0.6, -4), Vector3(8, 1.2, 0.1)], [Vector3(0, 0.6, 4), Vector3(8, 1.2, 0.1)], [Vector3(-4, 0.6, 0), Vector3(0.1, 1.2, 8)], [Vector3(4, 0.6, 0), Vector3(0.1, 1.2, 8)]]:
		_box(w[0], w[1], Color(0.9, 0.89, 0.85))
	for i in 8:   # floorboards
		_box(Vector3(-3.15 + i * 0.9, 0.001, 0), Vector3(0.015, 0.002, 8), Color(0.42, 0.31, 0.21))
	_box(Vector3(0, 0.003, 0.2), Vector3(2.6, 0.004, 1.8), Color(0.18, 0.28, 0.45))     # blue rug
	_box(Vector3(0, 0.005, 0.2), Vector3(2.3, 0.004, 1.5), Color(0.24, 0.36, 0.56))
	_box(Vector3(0, 0.6, -3.94), Vector3(1.0, 1.2, 0.04), Color(0.45, 0.3, 0.2))        # door
	_box(Vector3(-3.94, 0.75, -1.0), Vector3(0.04, 0.5, 1.4), Color(0.6, 0.78, 0.95))   # window
	_solid(Vector3(1.6, 0.25, -2.4), Vector3(0.8, 0.5, 0.5), Color(0.94, 0.5, 0.19))    # orange crate
	_box(Vector3(1.6, 0.6, -2.4), Vector3(0.5, 0.2, 0.4), Color(0.98, 0.7, 0.3))
	_solid(Vector3(-2.2, 0.45, -3.4), Vector3(1.6, 0.9, 0.6), Color(0.3, 0.33, 0.38))   # cabinet
	_box(Vector3(-2.2, 0.95, -3.4), Vector3(0.3, 0.1, 0.3), Color(0.31, 0.55, 1.0))
	# table: top + four legs (too low for the robot to walk under)
	_box(Vector3(2.3, 0.72, 0.8), Vector3(1.2, 0.05, 0.8), Color(0.62, 0.45, 0.3))
	obstacles.append([Vector2(2.3, 0.8), Vector2(0.6, 0.4)])
	for lx in [-0.55, 0.55]:
		for lz in [-0.35, 0.35]:
			_box(Vector3(2.3 + lx, 0.36, 0.8 + lz), Vector3(0.05, 0.72, 0.05), Color(0.4, 0.28, 0.18))
	_ball(Vector3(-0.9, 0.12, -1.2), 0.12, Color(0.94, 0.5, 0.19))
	_ball(Vector3(0.7, 0.09, -0.9), 0.09, Color(0.31, 0.55, 1.0))
	_ball(Vector3(-2.6, 0.2, 1.4), 0.2, Color(0.25, 0.7, 0.5))
	obstacles.append([Vector2(-2.6, 1.4), Vector2(0.2, 0.2)])
	_solid(Vector3(-2.4, 0.15, -0.4), Vector3(0.4, 0.3, 0.4), Color(0.31, 0.55, 1.0))   # blue box
	_solid(Vector3(3.2, 0.35, -1.0), Vector3(0.5, 0.7, 0.5), Color(0.25, 0.7, 0.5))     # green box
	for k in 6:   # traffic-cone course
		_cone(Vector3(-0.6 + (k % 2) * 1.2, 0, -0.2 - k * 0.5))
	var lamp := OmniLight3D.new(); lamp.position = Vector3(0, 1.4, 0); lamp.omni_range = 6; lamp.light_energy = 0.5
	add_child(lamp)

func _box(pos: Vector3, size: Vector3, color: Color) -> void:
	var m := MeshInstance3D.new()
	var b := BoxMesh.new(); b.size = size
	m.mesh = b
	var mat := StandardMaterial3D.new(); mat.albedo_color = color
	m.material_override = mat
	m.position = pos
	add_child(m)

func _solid(pos: Vector3, size: Vector3, color: Color) -> void:
	_box(pos, size, color)
	obstacles.append([Vector2(pos.x, pos.z), Vector2(size.x, size.z) / 2.0])

func _ball(pos: Vector3, rad: float, color: Color) -> void:
	var m := MeshInstance3D.new()
	var b := SphereMesh.new(); b.radius = rad; b.height = rad * 2
	m.mesh = b
	var mat := StandardMaterial3D.new(); mat.albedo_color = color; mat.roughness = 0.4
	m.material_override = mat
	m.position = pos
	add_child(m)

func _cone(pos: Vector3) -> void:
	var m := MeshInstance3D.new()
	var c := CylinderMesh.new(); c.top_radius = 0.01; c.bottom_radius = 0.07; c.height = 0.22
	m.mesh = c
	var mat := StandardMaterial3D.new(); mat.albedo_color = Color(1.0, 0.45, 0.1)
	m.material_override = mat
	m.position = pos + Vector3(0, 0.11, 0)
	add_child(m)

func drive(left: int, right: int) -> void:
	l = clampf(left, -100, 100) / 100.0
	r = clampf(right, -100, 100) / 100.0

func _free(p: Vector2) -> bool:
	if absf(p.x) > 3.95 - RADIUS or absf(p.y) > 3.95 - RADIUS:
		return false
	if p.distance_to(PLAYER) < 0.45 + RADIUS:
		return false
	for o in obstacles:
		var d: Vector2 = (p - o[0]).abs() - o[1]
		if d.x < RADIUS and d.y < RADIUS:
			return false
	return true

func _process(delta: float) -> void:
	var v := (l + r) / 2.0
	var w := (r - l) * 0.35 / TRACK * MAX_SPEED       # yaw rate (rad/s), + = turn left
	body.rotation.y += w * delta
	var fwd := -body.transform.basis.z
	var step_v := fwd * v * MAX_SPEED * delta
	var p := Vector2(body.position.x, body.position.z)
	var moved := 0.0
	for tryv in [Vector2(step_v.x, step_v.z), Vector2(step_v.x, 0), Vector2(0, step_v.z)]:   # slide along walls
		if tryv.length() > 0.0 and _free(p + tryv):
			p += tryv
			moved = tryv.length() * signf(v)
			break
	body.position = Vector3(p.x, 0, p.y)
	model.animate(delta, v if absf(moved) > 0.0001 or absf(v) < 0.04 else v * 0.3, clampf(w / 3.0, -1.0, 1.0))
	# camera in the visor
	cam.global_transform = body.global_transform * Transform3D(Basis(), Vector3(0, 0.97, -0.13))
	# tour progress
	step_t += delta
	if note_t > 0.0:
		note_t -= delta
		if note_t <= 0.0:
			note = ""
			changed.emit()
	marker.visible = step == 8
	if marker.visible:
		marker.position.y = 1.0 + sin(step_t * 3.0) * 0.08
		marker.rotation.y += delta * 1.5
	match step:
		0:
			if moved > 0.0: _add("fwd", moved)
			if acc.get("fwd", 0.0) >= 0.5: _next()
		1:
			if moved < 0.0: _add("back", -moved)
			if acc.get("back", 0.0) >= 0.3: _next()
		2:
			_add("yaw", absf(w * delta))
			if acc.get("yaw", 0.0) >= 2.6: _next()
		3:
			if maxf(absf(l), absf(r)) >= 0.97: _add("turbo", delta)
			if acc.get("turbo", 0.0) >= 0.6: _next()
		7:
			if arcade and absf(moved) > 0.0: _add("adist", absf(moved))
			if acc.get("adist", 0.0) >= 0.4: _next()
		8:
			if p.distance_to(TARGET) < 0.6: _next()

func _add(k: String, x: float) -> void:
	acc[k] = acc.get(k, 0.0) + x

## controller events from main.gd: stop, head, y, photo, arcade, talk, look, skip
func event(name: String) -> void:
	if name == "skip":
		if step >= LAST:
			_enter(0)
		else:
			_next()
		return
	match step:
		4:
			if name == "stop": _next()
		5:
			if name == "head" or name == "y": _next()
		6:
			if name == "photo": _next()
		9:
			if name == "talk" or name == "look": _next()

func _next() -> void:
	_enter(mini(step + 1, LAST))

func _enter(s: int) -> void:
	step = s
	acc = {}
	step_t = 0.0
	if s == 0 or s == LAST:
		model.wave(3.0 if s == 0 else 4.0)
	elif s > 0:
		model.nod()
	if cfg:
		cfg.set_value("demo", "step", step)
		cfg.save("user://avatar.cfg")
	changed.emit()

func tour_text() -> String:
	var head := "GUIDED TOUR  %d / %d" % [mini(step + 1, LAST), LAST] if step < LAST else "GUIDED TOUR  ✓"
	var t: String = head + "\n" + STEPS[step]
	if step < LAST:
		t += "\n(Left stick click = skip this step)"
	if note != "":
		t += "\n" + note
	return t

func photo() -> void:
	var img := vp.get_texture().get_image()
	DirAccess.make_dir_recursive_absolute("user://photos")
	photos += 1
	var f := "user://photos/demo-%d.png" % photos
	img.save_png(f)
	note = "📸 Photo saved (%dx%d)" % [img.get_width(), img.get_height()]
	note_t = 3.0
	model.nod()
	event("photo")
	changed.emit()
