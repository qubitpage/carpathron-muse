extends RefCounted
## Smooth shapes for the 3D models (1.4): rounded boxes (superellipsoids) with soft normals, so the robot and the
## controllers look moulded instead of boxy. Light enough for the Quest.

static func _sp(v: float, e: float) -> float:
	return signf(v) * pow(absf(v), e)

## a rounded box of the given size; round = 0.15 (nearly a box, soft edges) ... 1.0 (an ellipsoid)
static func rbox(size: Vector3, round := 0.35, seg := 22) -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var rings := maxi(8, seg * 2 / 3)
	var verts: Array = []
	for j in rings + 1:
		var th := -PI / 2 + PI * j / rings
		var row: Array = []
		for i in seg + 1:
			var ph := -PI + TAU * i / seg
			var ct := cos(th)
			var p := Vector3(_sp(ct, round) * _sp(cos(ph), round), _sp(sin(th), round), _sp(ct, round) * _sp(sin(ph), round))
			row.append(p * size * 0.5)
		verts.append(row)
	for j in rings:
		for i in seg:
			var a: Vector3 = verts[j][i]
			var b: Vector3 = verts[j][i + 1]
			var c: Vector3 = verts[j + 1][i]
			var d: Vector3 = verts[j + 1][i + 1]
			for q in [a, c, b, b, c, d]:
				st.add_vertex(q)
	st.index()
	st.generate_normals()
	return st.commit()

static func mat(c: Color, rough: float, metal := 0.0, emit := 0.0, clearcoat := false) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = rough
	m.metallic = metal
	if emit > 0.0:
		m.emission_enabled = true
		m.emission = c
		m.emission_energy_multiplier = emit
	if clearcoat:
		m.clearcoat_enabled = true
		m.clearcoat = 0.6
		m.clearcoat_roughness = 0.15
	return m

static func part(parent: Node3D, mesh: Mesh, m: Material, pos: Vector3, rot_deg := Vector3.ZERO, scl := Vector3.ONE) -> MeshInstance3D:
	var n := MeshInstance3D.new()
	n.mesh = mesh
	n.material_override = m
	n.position = pos
	n.rotation_degrees = rot_deg
	n.scale = scl
	n.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(n)
	return n

static func cyl(r: float, h: float, seg := 24) -> CylinderMesh:
	var c := CylinderMesh.new(); c.top_radius = r; c.bottom_radius = r; c.height = h; c.radial_segments = seg; c.rings = 1
	return c

static func cone(r0: float, r1: float, h: float, seg := 24) -> CylinderMesh:
	var c := CylinderMesh.new(); c.top_radius = r1; c.bottom_radius = r0; c.height = h; c.radial_segments = seg; c.rings = 1
	return c

static func sph(r: float, seg := 24) -> SphereMesh:
	var s := SphereMesh.new(); s.radius = r; s.height = r * 2; s.radial_segments = seg; s.rings = seg / 2
	return s

static func cap(r: float, h: float, seg := 20) -> CapsuleMesh:
	var c := CapsuleMesh.new(); c.radius = r; c.height = h; c.radial_segments = seg; c.rings = 6
	return c

static func torus(r_in: float, r_out: float, seg := 32) -> TorusMesh:
	var t := TorusMesh.new(); t.inner_radius = r_in; t.outer_radius = r_out; t.rings = seg; t.ring_segments = 12
	return t
