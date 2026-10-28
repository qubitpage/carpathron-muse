extends Node3D
## Demo robot: a virtual Carpathron car in a small virtual room, used when no real robot is on the Wi-Fi
## (and by Meta's store reviewers). Same controls as the real robot: tank wheel speeds -100..100.
## Its camera renders into a texture shown on the big screen, exactly like the real robot's live video.

var texture: Texture2D
var vp: SubViewport
var cam: Camera3D
var body: Node3D
var l := 0.0
var r := 0.0
const MAX_SPEED := 0.9        # m/s at 100 %
const TRACK := 0.16           # wheel distance, m

func _ready() -> void:
	vp = SubViewport.new()
	vp.size = Vector2i(640, 480)
	vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	vp.own_world_3d = true
	add_child(vp)
	var world := Node3D.new()
	vp.add_child(world)
	var env := WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_COLOR
	e.background_color = Color(0.55, 0.62, 0.7)
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(0.75, 0.75, 0.78)
	env.environment = e
	world.add_child(env)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-55, 35, 0)
	world.add_child(sun)
	# room 8 x 8 m: wooden floor, walls, a rug, furniture and toys in brand colours
	_box(world, Vector3(0, -0.05, 0), Vector3(8, 0.1, 8), Color(0.55, 0.42, 0.3))
	for w in [[Vector3(0, 0.6, -4), Vector3(8, 1.2, 0.1)], [Vector3(0, 0.6, 4), Vector3(8, 1.2, 0.1)], [Vector3(-4, 0.6, 0), Vector3(0.1, 1.2, 8)], [Vector3(4, 0.6, 0), Vector3(0.1, 1.2, 8)]]:
		_box(world, w[0], w[1], Color(0.9, 0.89, 0.85))
	for i in 8:   # floorboards
		_box(world, Vector3(-3.15 + i * 0.9, 0.001, 0), Vector3(0.015, 0.002, 8), Color(0.42, 0.31, 0.21))
	_box(world, Vector3(0, 0.003, 0.2), Vector3(2.6, 0.004, 1.8), Color(0.18, 0.28, 0.45))     # blue rug
	_box(world, Vector3(0, 0.005, 0.2), Vector3(2.3, 0.004, 1.5), Color(0.24, 0.36, 0.56))
	_box(world, Vector3(0, 0.6, -3.94), Vector3(1.0, 1.2, 0.04), Color(0.45, 0.3, 0.2))        # door
	_box(world, Vector3(-3.94, 0.75, -1.0), Vector3(0.04, 0.5, 1.4), Color(0.6, 0.78, 0.95))   # window
	_box(world, Vector3(1.6, 0.25, -2.4), Vector3(0.8, 0.5, 0.5), Color(0.94, 0.5, 0.19))     # orange crate
	_box(world, Vector3(1.6, 0.6, -2.4), Vector3(0.5, 0.2, 0.4), Color(0.98, 0.7, 0.3))
	_box(world, Vector3(-2.2, 0.45, -3.4), Vector3(1.6, 0.9, 0.6), Color(0.3, 0.33, 0.38))    # cabinet
	_box(world, Vector3(-2.2, 0.95, -3.4), Vector3(0.3, 0.1, 0.3), Color(0.31, 0.55, 1.0))
	# table: top + four legs
	_box(world, Vector3(2.3, 0.72, 0.8), Vector3(1.2, 0.05, 0.8), Color(0.62, 0.45, 0.3))
	for lx in [-0.55, 0.55]:
		for lz in [-0.35, 0.35]:
			_box(world, Vector3(2.3 + lx, 0.36, 0.8 + lz), Vector3(0.05, 0.72, 0.05), Color(0.4, 0.28, 0.18))
	_ball(world, Vector3(-0.9, 0.12, -1.2), 0.12, Color(0.94, 0.5, 0.19))
	_ball(world, Vector3(0.7, 0.09, -0.9), 0.09, Color(0.31, 0.55, 1.0))
	_ball(world, Vector3(-2.6, 0.2, 1.4), 0.2, Color(0.25, 0.7, 0.5))
	_box(world, Vector3(-2.4, 0.15, -0.4), Vector3(0.4, 0.3, 0.4), Color(0.31, 0.55, 1.0))   # blue box
	_box(world, Vector3(3.2, 0.35, -1.0), Vector3(0.5, 0.7, 0.5), Color(0.25, 0.7, 0.5))     # green box
	for k in 6:   # traffic-cone course
		_cone(world, Vector3(-0.6 + (k % 2) * 1.2, 0, -0.2 - k * 0.5))
	var lamp := OmniLight3D.new(); lamp.position = Vector3(0, 1.1, 0); lamp.omni_range = 6; lamp.light_energy = 0.6
	world.add_child(lamp)
	# the robot camera, 10 cm above the floor like the ESP32-CAM
	body = Node3D.new()
	body.position = Vector3(0, 0, 2.6)
	world.add_child(body)
	cam = Camera3D.new()
	cam.position = Vector3(0, 0.1, -0.08)
	cam.fov = 50.0
	body.add_child(cam)
	texture = vp.get_texture()

func _box(parent: Node3D, pos: Vector3, size: Vector3, color: Color) -> void:
	var m := MeshInstance3D.new()
	var b := BoxMesh.new(); b.size = size
	m.mesh = b
	var mat := StandardMaterial3D.new(); mat.albedo_color = color
	m.material_override = mat
	m.position = pos
	parent.add_child(m)

func _ball(parent: Node3D, pos: Vector3, rad: float, color: Color) -> void:
	var m := MeshInstance3D.new()
	var b := SphereMesh.new(); b.radius = rad; b.height = rad * 2
	m.mesh = b
	var mat := StandardMaterial3D.new(); mat.albedo_color = color; mat.roughness = 0.4
	m.material_override = mat
	m.position = pos
	parent.add_child(m)

func _cone(parent: Node3D, pos: Vector3) -> void:
	var m := MeshInstance3D.new()
	var c := CylinderMesh.new(); c.top_radius = 0.01; c.bottom_radius = 0.07; c.height = 0.22
	m.mesh = c
	var mat := StandardMaterial3D.new(); mat.albedo_color = Color(1.0, 0.45, 0.1)
	m.material_override = mat
	m.position = pos + Vector3(0, 0.11, 0)
	parent.add_child(m)

func drive(left: int, right: int) -> void:
	l = clampf(left, -100, 100) / 100.0
	r = clampf(right, -100, 100) / 100.0

func _process(delta: float) -> void:
	var v := (l + r) / 2.0 * MAX_SPEED
	var w := (r - l) * MAX_SPEED / TRACK * 0.35     # yaw rate (rad/s), + = turn left
	body.rotation.y += w * delta
	var fwd := -body.global_transform.basis.z
	var p := body.position + fwd * v * delta
	p.x = clampf(p.x, -3.7, 3.7)
	p.z = clampf(p.z, -3.7, 3.7)
	body.position = p
