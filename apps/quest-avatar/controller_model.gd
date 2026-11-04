extends Node3D
## Carpathron Avatar 1.4 — a Quest-style controller in your hand (shaped like the Touch Plus controllers of the
## Quest 3 / 3S): rounded handle, head with thumbstick, two face buttons, menu button, trigger and grip.
## The parts move with your fingers (stick tilts, buttons light up, trigger and grip press in), and labels show
## what each one does when you look at the controller.
## Lives under an XRController3D with the grip pose: -Z = forward through your fist, +Y = up.

const Shapes = preload("res://shapes.gd")

var right := true
var stick_cap: Node3D
var btn_a: MeshInstance3D
var btn_b: MeshInstance3D
var btn_menu: MeshInstance3D
var trigger: Node3D
var grip_btn: Node3D
var hints: Node3D
var _mat_btn: StandardMaterial3D
var _mat_lit: StandardMaterial3D
var labels := {}

func _init(is_right := true) -> void:
	right = is_right

func _ready() -> void:
	var sx := 1.0 if right else -1.0
	var body := Shapes.mat(Color(0.11, 0.115, 0.125), 0.55, 0.0, 0.0, true)
	var face := Shapes.mat(Color(0.07, 0.075, 0.085), 0.35, 0.0, 0.0, true)
	var accent := Shapes.mat(Color(0.2, 0.21, 0.23), 0.4, 0.4)
	_mat_btn = Shapes.mat(Color(0.16, 0.17, 0.19), 0.3)
	_mat_lit = Shapes.mat(Color(1.0, 0.56, 0.16), 0.3, 0.0, 2.2)
	var root := Node3D.new()
	add_child(root)
	# handle (the part in your fist), slightly bent like the real one
	Shapes.part(root, Shapes.rbox(Vector3(0.037, 0.05, 0.13), 0.5), body, Vector3(0, -0.014, 0.026), Vector3(-32, 0, 0))
	# head: the oval top with the thumbstick and buttons, tilted towards your thumb
	var head := Node3D.new()
	head.position = Vector3(sx * -0.004, 0.022, -0.035)
	head.rotation_degrees = Vector3(14, 0, sx * -6)
	root.add_child(head)
	Shapes.part(head, Shapes.rbox(Vector3(0.066, 0.032, 0.072), 0.45), body, Vector3.ZERO)
	Shapes.part(head, Shapes.rbox(Vector3(0.058, 0.006, 0.062), 0.4), face, Vector3(0, 0.0145, 0))     # glossy face plate
	# thumbstick: base ring + cap (on the inner side)
	var sp := Vector3(sx * -0.011, 0.017, 0.006)
	Shapes.part(head, Shapes.torus(0.0085, 0.0125), accent, sp + Vector3(0, 0.001, 0))
	stick_cap = Node3D.new()
	stick_cap.position = sp
	head.add_child(stick_cap)
	Shapes.part(stick_cap, Shapes.cyl(0.004, 0.012, 12), accent, Vector3(0, 0.006, 0))
	Shapes.part(stick_cap, Shapes.rbox(Vector3(0.019, 0.007, 0.019), 0.6), _mat_btn, Vector3(0, 0.013, 0))
	# face buttons A/B (right) or X/Y (left) on the outer side, menu / Meta button below the stick
	btn_a = Shapes.part(head, Shapes.cyl(0.0058, 0.005, 16), _mat_btn, Vector3(sx * 0.013, 0.0175, 0.012))
	btn_b = Shapes.part(head, Shapes.cyl(0.0058, 0.005, 16), _mat_btn, Vector3(sx * 0.019, 0.0175, -0.005))
	btn_menu = Shapes.part(head, Shapes.cyl(0.0035, 0.004, 12), _mat_btn, Vector3(sx * -0.004, 0.0172, 0.024))
	for b in [[btn_a, "A" if right else "X"], [btn_b, "B" if right else "Y"]]:
		var l := Label3D.new()
		l.text = b[1]
		l.font_size = 32
		l.pixel_size = 0.00018
		l.modulate = Color(0.75, 0.78, 0.84)
		l.outline_size = 0
		l.rotation_degrees = Vector3(-90, 0, 0)
		l.position = b[0].position + Vector3(0, 0.0032, 0)
		head.add_child(l)
	# trigger (index finger) under the front of the head, grip button on the inner side of the handle
	trigger = Node3D.new()
	trigger.position = Vector3(0, -0.006, -0.058)
	head.add_child(trigger)
	Shapes.part(trigger, Shapes.rbox(Vector3(0.02, 0.03, 0.014), 0.5), accent, Vector3(0, -0.012, 0), Vector3(-25, 0, 0))
	grip_btn = Node3D.new()
	grip_btn.position = Vector3(sx * -0.017, -0.012, 0.005)
	root.add_child(grip_btn)
	Shapes.part(grip_btn, Shapes.rbox(Vector3(0.008, 0.032, 0.05), 0.5), accent, Vector3.ZERO, Vector3(-18, 0, 0))
	# labels: what each control does (shown when you look at the controller)
	hints = Node3D.new()
	add_child(hints)
	hints.visible = false

func _local_pos(n: Node3D) -> Vector3:
	var t := Transform3D()
	var c: Node = n
	while c != null and c != self:
		t = (c as Node3D).transform * t
		c = c.get_parent()
	return t.origin

## set the label texts: {stick, a, b, menu, trigger, grip} — a tidy column on the outer side of the controller
func set_hints(h: Dictionary) -> void:
	for c in hints.get_children():
		c.queue_free()
	var sx := 1.0 if right else -1.0
	var parts := {"b": btn_b, "a": btn_a, "stick": stick_cap, "menu": btn_menu, "trigger": trigger, "grip": grip_btn}
	var y := 0.075
	for k in ["b", "a", "stick", "menu", "trigger", "grip"]:
		if not h.has(k) or str(h[k]) == "":
			continue
		var anchor := _local_pos(parts[k])
		var spot := Vector3(sx * 0.08, y, -0.02)
		y -= 0.03
		var l := Label3D.new()
		l.text = str(h[k])
		l.font_size = 36
		l.pixel_size = 0.00042
		l.outline_size = 10
		l.outline_modulate = Color(0.03, 0.04, 0.06, 0.95)
		l.modulate = Color(1.0, 0.78, 0.45)
		l.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		l.no_depth_test = true
		l.render_priority = 3
		l.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT if right else HORIZONTAL_ALIGNMENT_RIGHT
		l.position = spot + Vector3(sx * 0.004, 0, 0)
		l.layers = 2
		hints.add_child(l)
		var line := MeshInstance3D.new()
		line.mesh = Shapes.cyl(0.00045, anchor.distance_to(spot), 6)
		var lm := Shapes.mat(Color(1.0, 0.75, 0.4), 1.0)
		lm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		lm.no_depth_test = true
		line.material_override = lm
		line.position = (anchor + spot) / 2
		line.basis = Basis(Quaternion(Vector3.UP, (spot - anchor).normalized()))
		line.layers = 2
		hints.add_child(line)
		var dot := MeshInstance3D.new()
		dot.mesh = Shapes.sph(0.0018, 8)
		dot.material_override = lm
		dot.position = anchor
		dot.layers = 2
		hints.add_child(dot)

## live state from the real controller
func update(stick: Vector2, a: bool, b: bool, menu: bool, trig: float, grip: float) -> void:
	stick_cap.rotation = Vector3(-stick.y * 0.35, 0, -stick.x * 0.35)
	btn_a.material_override = _mat_lit if a else _mat_btn
	btn_b.material_override = _mat_lit if b else _mat_btn
	btn_menu.material_override = _mat_lit if menu else _mat_btn
	btn_a.position.y = 0.0165 if a else 0.0175
	btn_b.position.y = 0.0165 if b else 0.0175
	trigger.rotation.x = trig * 0.35
	grip_btn.position.x = (0.0 if right else 0.0) + (1.0 if right else -1.0) * (-0.017 + grip * 0.004)
