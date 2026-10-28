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
	# room 8 x 8 m: floor, four walls, furniture-like boxes in brand colours
	_box(world, Vector3(0, -0.05, 0), Vector3(8, 0.1, 8), Color(0.42, 0.36, 0.3))
	for w in [[Vector3(0, 0.6, -4), Vector3(8, 1.2, 0.1)], [Vector3(0, 0.6, 4), Vector3(8, 1.2, 0.1)], [Vector3(-4, 0.6, 0), Vector3(0.1, 1.2, 8)], [Vector3(4, 0.6, 0), Vector3(0.1, 1.2, 8)]]:
		_box(world, w[0], w[1], Color(0.88, 0.88, 0.86))
	_box(world, Vector3(1.2, 0.25, -1.8), Vector3(0.8, 0.5, 0.5), Color(0.94, 0.5, 0.19))   # orange crate
	_box(world, Vector3(-1.6, 0.4, -2.2), Vector3(1.2, 0.8, 0.6), Color(0.3, 0.33, 0.38))  # dark cabinet
	_box(world, Vector3(-2.2, 0.15, 1.5), Vector3(0.4, 0.3, 0.4), Color(0.31, 0.55, 1.0))  # blue box
	_box(world, Vector3(2.4, 0.35, 1.8), Vector3(0.5, 0.7, 0.5), Color(0.25, 0.7, 0.5))    # green box
	for i in 6:   # floor stripes to feel speed
		_box(world, Vector3(0, 0.001, -3.0 + i * 1.2), Vector3(0.05, 0.002, 0.6), Color(1, 1, 1))
	# the robot camera, 10 cm above the floor like the ESP32-CAM
	body = Node3D.new()
	body.position = Vector3(0, 0, 2.5)
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
