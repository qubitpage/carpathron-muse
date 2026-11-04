extends Node3D
const Shapes = preload("res://shapes.gd")
## The Carpathron robot in 3D: white shell, black visor with orange eyes and smile, orange CARPATHRON chest
## plate, dark joints. Built from simple shapes (light for Quest). Faces -Z, about 1.07 m tall.
## animate() plays walking, turning on the spot, idle breathing, blinking and waving.

const WHITE := Color(0.86, 0.87, 0.88)
const DARK := Color(0.13, 0.14, 0.16)
const BLACK := Color(0.015, 0.015, 0.02)
const ORANGE := Color(0.96, 0.5, 0.16)
const GLOW := Color(1.0, 0.55, 0.12)

var white: StandardMaterial3D
var dark: StandardMaterial3D
var black: StandardMaterial3D
var orange: StandardMaterial3D
var glow: StandardMaterial3D
var root: Node3D            # everything, bobs while walking
var head: Node3D
var eyes: Array[Node3D] = []
var hip_l: Node3D
var hip_r: Node3D
var knee_l: Node3D
var knee_r: Node3D
var sh_l: Node3D
var sh_r: Node3D
var el_l: Node3D
var el_r: Node3D
var chest: Node3D
var phase := 0.0
var wave_t := 0.0           # seconds of waving left
var nod_t := 0.0            # seconds of a happy nod left
var blink_t := 2.0
var t := 0.0

func _mat(c: Color, rough: float, metal := 0.0, emit := false) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = rough
	m.metallic = metal
	if emit:
		m.emission_enabled = true
		m.emission = c
		m.emission_energy_multiplier = 2.5
	return m

func _part(parent: Node3D, mesh: Mesh, mat: Material, pos: Vector3, rot_deg := Vector3.ZERO, scl := Vector3.ONE) -> MeshInstance3D:
	var m := MeshInstance3D.new()
	m.mesh = mesh
	m.material_override = mat
	m.position = pos
	m.rotation_degrees = rot_deg
	m.scale = scl
	m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(m)
	return m

func _pivot(parent: Node3D, pos: Vector3) -> Node3D:
	var p := Node3D.new()
	p.position = pos
	parent.add_child(p)
	return p

static func _box(x: float, y: float, z: float) -> BoxMesh:
	var b := BoxMesh.new(); b.size = Vector3(x, y, z); return b

static func _sph(r: float) -> SphereMesh:
	var s := SphereMesh.new(); s.radius = r; s.height = r * 2; s.radial_segments = 20; s.rings = 10; return s

static func _cap(r: float, h: float) -> CapsuleMesh:
	var c := CapsuleMesh.new(); c.radius = r; c.height = h; c.radial_segments = 16; c.rings = 4; return c

static func _cyl(r: float, h: float) -> CylinderMesh:
	var c := CylinderMesh.new(); c.top_radius = r; c.bottom_radius = r; c.height = h; c.radial_segments = 18; return c

func _ready() -> void:
	# 1.4: moulded look like the Carpathron poster — glossy white shell, big black glass visor with glowing
	# eyes and smile, black joint discs on the shoulders, orange chest plate with the mountains
	white = Shapes.mat(WHITE, 0.28, 0.0, 0.0, true)
	dark = Shapes.mat(DARK, 0.45, 0.35)
	black = Shapes.mat(BLACK, 0.04, 0.3, 0.0, true)
	orange = Shapes.mat(ORANGE, 0.45, 0.0, 0.0, true)
	glow = Shapes.mat(GLOW, 0.3, 0.0, 3.0)
	var grey := Shapes.mat(Color(0.55, 0.57, 0.6), 0.35, 0.5)
	root = _pivot(self, Vector3.ZERO)
	# ---- pelvis, belly (dark mechanics), chest
	_part(root, Shapes.rbox(Vector3(0.22, 0.09, 0.14), 0.4), white, Vector3(0, 0.53, 0))
	_part(root, Shapes.cyl(0.07, 0.12), dark, Vector3(0, 0.62, 0))
	for i in 3:   # belly rings
		_part(root, Shapes.torus(0.066, 0.079), dark, Vector3(0, 0.585 + i * 0.03, 0))
	chest = _pivot(root, Vector3(0, 0.76, 0))
	_part(chest, Shapes.rbox(Vector3(0.3, 0.24, 0.17), 0.32), white, Vector3.ZERO)
	_part(chest, Shapes.rbox(Vector3(0.22, 0.06, 0.15), 0.45), white, Vector3(0, -0.12, 0.0))
	# chest plate with the Carpathron mountains + name
	_part(chest, Shapes.rbox(Vector3(0.16, 0.115, 0.016), 0.28), orange, Vector3(0, -0.005, -0.084))
	var mnt := PrismMesh.new(); mnt.size = Vector3(0.056, 0.034, 0.004)
	_part(chest, mnt, black, Vector3(-0.012, 0.016, -0.0935))
	var mnt2 := PrismMesh.new(); mnt2.size = Vector3(0.04, 0.025, 0.004)
	_part(chest, mnt2, black, Vector3(0.024, 0.0115, -0.0935))
	var snow := PrismMesh.new(); snow.size = Vector3(0.014, 0.009, 0.0045)
	_part(chest, snow, white, Vector3(-0.012, 0.0285, -0.0937))
	var name_lbl := Label3D.new()
	name_lbl.text = "CARPATHRON"
	name_lbl.font_size = 64
	name_lbl.outline_size = 0
	name_lbl.pixel_size = 0.0003
	name_lbl.modulate = BLACK
	name_lbl.position = Vector3(0, -0.029, -0.0935)
	name_lbl.rotation_degrees = Vector3(0, 180, 0)
	name_lbl.double_sided = false
	chest.add_child(name_lbl)
	# panel seams and vents
	for sx in [-0.1, 0.1]:
		_part(chest, Shapes.rbox(Vector3(0.035, 0.005, 0.004), 0.5), dark, Vector3(sx, 0.09, -0.082))
	# ---- neck (dark, ribbed) + helmet head
	_part(root, Shapes.cyl(0.04, 0.07), dark, Vector3(0, 0.885, 0))
	for i in 2:
		_part(root, Shapes.torus(0.038, 0.047), grey, Vector3(0, 0.87 + i * 0.025, 0))
	head = _pivot(root, Vector3(0, 0.9, 0))
	_part(head, Shapes.rbox(Vector3(0.25, 0.21, 0.22), 0.36), white, Vector3(0, 0.1, 0.005))
	# the visor: a big rounded black glass on the front
	_part(head, Shapes.rbox(Vector3(0.2, 0.135, 0.06), 0.3), black, Vector3(0, 0.095, -0.088))
	for sx in [-1.0, 1.0]:
		# eyes: short glowing bars, slanted like a smile
		var e := _pivot(head, Vector3(sx * 0.038, 0.112, -0.1195))
		_part(e, Shapes.rbox(Vector3(0.032, 0.0075, 0.004), 0.5), glow, Vector3.ZERO, Vector3(0, 0, -sx * 10))
		eyes.append(e)
		# ear cups: white disc with a dark ring
		_part(head, Shapes.cyl(0.05, 0.03, 28), white, Vector3(sx * 0.128, 0.098, 0.005), Vector3(0, 0, 90))
		_part(head, Shapes.torus(0.032, 0.045), dark, Vector3(sx * 0.143, 0.098, 0.005), Vector3(0, 0, 90))
		# top lights
		_part(head, Shapes.rbox(Vector3(0.028, 0.01, 0.014), 0.5), glow, Vector3(sx * 0.055, 0.204, -0.05))
	for i in 9:   # smile: a small glowing arc
		var a := deg_to_rad(-64.0 + i * 16.0)
		_part(head, Shapes.rbox(Vector3(0.0075, 0.0055, 0.004), 0.6), glow, Vector3(sin(a) * 0.026, 0.083 - cos(a) * 0.012, -0.1195), Vector3(0, 0, rad_to_deg(a) * 0.7))
	# ---- arms (pivots at the shoulders; arms hang along -Y)
	var arms := []
	for sx in [-1.0, 1.0]:
		var sh := _pivot(root, Vector3(sx * 0.19, 0.82, 0))
		_part(sh, Shapes.rbox(Vector3(0.12, 0.12, 0.12), 0.75), white, Vector3(sx * 0.012, 0, 0))
		_part(sh, Shapes.cyl(0.042, 0.02, 28), black, Vector3(sx * 0.07, 0, 0), Vector3(0, 0, 90))     # joint disc
		_part(sh, Shapes.torus(0.03, 0.044), grey, Vector3(sx * 0.073, 0, 0), Vector3(0, 0, 90))
		_part(sh, Shapes.cyl(0.035, 0.05), dark, Vector3(0, -0.06, 0))
		_part(sh, Shapes.rbox(Vector3(0.072, 0.15, 0.072), 0.55), white, Vector3(0, -0.125, 0))
		var el := _pivot(sh, Vector3(0, -0.21, 0))
		_part(el, Shapes.sph(0.035), dark, Vector3.ZERO)
		_part(el, Shapes.rbox(Vector3(0.068, 0.15, 0.068), 0.55), white, Vector3(0, -0.09, 0))
		var hand := _pivot(el, Vector3(0, -0.175, 0))
		_part(hand, Shapes.rbox(Vector3(0.058, 0.06, 0.03), 0.5), dark, Vector3(0, -0.025, 0))
		for f in 4:
			_part(hand, Shapes.cap(0.0085, 0.05, 10), dark, Vector3(-0.0195 + f * 0.013, -0.072, 0))
		_part(hand, Shapes.cap(0.0095, 0.045, 10), dark, Vector3(-sx * 0.035, -0.035, -0.008), Vector3(0, 0, sx * 35))
		arms.append([sh, el])
	sh_r = arms[1][0]; el_r = arms[1][1]    # +X is the robot's right side (it faces -Z)
	sh_l = arms[0][0]; el_l = arms[0][1]
	# ---- legs (pivots at the hips)
	var legs := []
	for sx in [-1.0, 1.0]:
		var hip := _pivot(root, Vector3(sx * 0.07, 0.5, 0))
		_part(hip, Shapes.sph(0.045), dark, Vector3.ZERO)
		_part(hip, Shapes.rbox(Vector3(0.09, 0.19, 0.095), 0.55), white, Vector3(0, -0.1, 0))
		var knee := _pivot(hip, Vector3(0, -0.2, 0))
		_part(knee, Shapes.cyl(0.04, 0.085), dark, Vector3.ZERO, Vector3(0, 0, 90))
		_part(knee, Shapes.rbox(Vector3(0.07, 0.055, 0.03), 0.5), white, Vector3(0, 0.0, -0.042))     # knee cap
		_part(knee, Shapes.rbox(Vector3(0.088, 0.2, 0.092), 0.55), white, Vector3(0, -0.11, 0))
		var ankle := _pivot(knee, Vector3(0, -0.22, 0))
		_part(ankle, Shapes.cyl(0.03, 0.06), dark, Vector3.ZERO, Vector3(0, 0, 90))
		_part(ankle, Shapes.rbox(Vector3(0.1, 0.05, 0.175), 0.4), white, Vector3(0, -0.035, -0.025))
		_part(ankle, Shapes.rbox(Vector3(0.104, 0.016, 0.178), 0.35), dark, Vector3(0, -0.063, -0.025))
		legs.append([hip, knee])
	hip_l = legs[0][0]; knee_l = legs[0][1]
	hip_r = legs[1][0]; knee_r = legs[1][1]

func wave(seconds := 2.6) -> void:
	wave_t = seconds

func nod() -> void:
	nod_t = 0.8

## v = forward speed -1..1, w = turn rate -1..1 (+ = left)
func animate(delta: float, v: float, w: float) -> void:
	t += delta
	var moving := absf(v) > 0.04 or absf(w) > 0.04
	var amp := clampf(absf(v) * 0.55 + absf(w) * 0.3, 0.0, 0.6)
	var k := minf(1.0, delta * 8.0)
	if moving:
		phase += delta * (5.0 + 5.0 * maxf(absf(v), absf(w) * 0.6)) * (1.0 if v >= -0.04 else -1.0)
	var s := sin(phase) if moving else 0.0
	hip_l.rotation.x = lerpf(hip_l.rotation.x, s * amp, k)
	hip_r.rotation.x = lerpf(hip_r.rotation.x, -s * amp, k)
	knee_l.rotation.x = lerpf(knee_l.rotation.x, -maxf(0.0, -s) * amp * 1.3, k)
	knee_r.rotation.x = lerpf(knee_r.rotation.x, -maxf(0.0, s) * amp * 1.3, k)
	sh_l.rotation.x = lerpf(sh_l.rotation.x, -s * amp * 0.9, k)
	el_l.rotation.x = lerpf(el_l.rotation.x, 0.2 + amp * 0.4, k)
	root.position.y = lerpf(root.position.y, absf(s) * 0.014 * amp / 0.6 if moving else sin(t * 2.0) * 0.003, k)
	chest.rotation.z = lerpf(chest.rotation.z, -w * 0.05, k)
	# right arm: walk swing, or wave hello like on the poster
	if wave_t > 0.0:
		wave_t -= delta
		sh_r.rotation.x = lerpf(sh_r.rotation.x, 0.15, k)
		sh_r.rotation.z = lerpf(sh_r.rotation.z, 2.35, k)
		el_r.rotation.z = lerpf(el_r.rotation.z, 0.75 + 0.35 * sin(t * 9.0), k)
		el_r.rotation.x = lerpf(el_r.rotation.x, 0.0, k)
	else:
		sh_r.rotation.x = lerpf(sh_r.rotation.x, s * amp * 0.9, k)
		sh_r.rotation.z = lerpf(sh_r.rotation.z, 0.06, k)
		el_r.rotation.z = lerpf(el_r.rotation.z, 0.0, k)
		el_r.rotation.x = lerpf(el_r.rotation.x, 0.2 + amp * 0.4, k)
	sh_l.rotation.z = lerpf(sh_l.rotation.z, -0.06, k)
	# head: looks into the turn, happy nod, idle glances
	var nod_x := 0.0
	if nod_t > 0.0:
		nod_t -= delta
		nod_x = sin(nod_t * 16.0) * 0.18
	head.rotation.y = lerpf(head.rotation.y, w * 0.35 + (0.0 if moving else sin(t * 0.7) * 0.12), k)
	head.rotation.x = lerpf(head.rotation.x, nod_x, minf(1.0, delta * 14.0))
	# blink
	blink_t -= delta
	var open := 1.0
	if blink_t < 0.0:
		open = 0.15
		if blink_t < -0.12:
			blink_t = randf_range(2.0, 5.0)
	for e in eyes:
		e.scale.y = open
