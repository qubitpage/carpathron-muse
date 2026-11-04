extends Node3D
## Carpathron Avatar 1.5 — "Carpathron in my room" (mixed reality on Meta Quest 3 / 3S).
## Passthrough is on: you see your real room and the 3D Carpathron stands on your real floor. He looks at you,
## listens (hold the right grip, or hands-free), answers with a natural voice from his head, and does what you ask:
## come here, follow me, stay, go to the chair, turn, dance, wave, look around... Point at the floor and pull the
## trigger to send him there. The headset camera shows Muse (PC) what you see: the objects it recognises get a small
## glowing marker and a name tag in the room, and Carpathron remembers where they are ("go to the plant").
## With a real robot car connected, the car does the tasks for real and this Carpathron is its voice and face.

signal note(text: String)

const RobotModel = preload("res://robot_model.gd")
const Talk = preload("res://talk.gd")
const Pill = preload("res://pill.gd")
const COLORS := {"human": Color(1.0, 0.66, 0.3), "animal": Color(0.36, 0.9, 0.58), "obstacle": Color(1.0, 0.42, 0.42),
	"furniture": Color(0.55, 0.68, 1.0), "door": Color(0.95, 0.82, 0.45), "item": Color(0.42, 0.85, 1.0)}
const MOOD_EYES := {"happy": Color(1.0, 0.55, 0.12), "excited": Color(1.0, 0.75, 0.2), "curious": Color(0.35, 0.8, 1.0),
	"thinking": Color(0.7, 0.55, 1.0), "calm": Color(0.45, 0.95, 0.75), "sorry": Color(0.55, 0.6, 0.75), "proud": Color(1.0, 0.85, 0.3)}
const SIZE := 0.62            # Carpathron is ~1.07 m as a model; in a room he is a small robot (~66 cm)
const SPEED := 0.55           # m/s walking
const HFOV := 76.0            # the headset camera picture (degrees, 4:3)
const NEAR_USER := 1.0        # how close he comes ("come here")
const MAX_RANGE := 3.5        # without a room scan he stays within this distance of you

var cam: Node3D               # the headset camera
var muse: Node
var talk: Talk
var body: Node3D
var model: Node3D
var bubble: Pill
var mic_icon: Pill
var anchors := {}             # label -> {pos: Vector3, kind, at, node, n}
var poses := {}               # headset camera picture id -> head pose when it was taken
var frame_id := 0
var next_eyes := 0
var cam_plugin = null         # Android plugin "CarpathronRoomCam" (headset camera)
var cam_status := "off"
var last_seen := -1
var real := false             # a real robot car is connected: it does the tasks
var passthrough := false
var room_image := ""          # desktop test: a picture used as "the headset camera"
var view_tex: ImageTexture = null   # the newest headset camera picture (tests)
var view_img: Image = null          # the same picture, for the PC view (the 3D is laid over it there)
var cam_luma := -1.0                # how bright the camera picture is (0..1), in the log
var cam_info := ""                  # the cameras the headset offers ("id:source/position,...")
var cam_index := 0                  # which of them is used
var _cam_try := 0                   # cameras tried (a black picture -> the next one)
var _black_since := 0
var _view_at := 0
var _view_frames := -1

var behaviour := "idle"       # idle | walk | follow | dance | spin
var target := Vector3.ZERO
var after := ""               # what to do when he arrives ("look", "wave", "point")
var spin_left := 0.0
var dance_t := 0.0
var turn_goal := NAN
var v_now := 0.0
var w_now := 0.0
var mood := "happy"
var bubble_t := 0.0
var talk_level := 0.0
var highlight: Node3D = null
var shadow: MeshInstance3D
var car_anchor := Vector3.ZERO   # real car: where his voice and words are (under the camera window)
var man_v := 0.0
# ---- guided driving of the real car (the headset sees the car and the goal, Muse/the car only gets wheel commands)
const CAR_TURN_MS360 := 2400.0   # full turn at speed 70 (same calibration as the rest of the app)
var car_speed := 0.30            # m/s at speed 60 — learned while driving
var nav := {}
var last_reply := {}
var _warned_old := false
var man_w := 0.0
var highlight_t := 0.0

func _ready() -> void:
	body = Node3D.new()
	add_child(body)
	model = RobotModel.new()
	model.scale = Vector3.ONE * SIZE
	body.add_child(model)
	# a soft round shadow under him (helps him "stand" on the real floor)
	var sh := MeshInstance3D.new()
	shadow = sh
	var q := QuadMesh.new(); q.size = Vector2(0.55, 0.55); q.orientation = PlaneMesh.FACE_Y
	sh.mesh = q
	var sm := ShaderMaterial.new(); var sd := Shader.new()
	sd.code = "shader_type spatial;\nrender_mode unshaded, blend_mix, depth_draw_never, cull_disabled;\nvoid fragment(){ float d = length(UV - 0.5) * 2.0; ALBEDO = vec3(0.0); ALPHA = 0.42 * (1.0 - smoothstep(0.35, 1.0, d)); }"
	sm.shader = sd
	sh.material_override = sm
	sh.position.y = 0.004
	body.add_child(sh)
	bubble = Pill.new(34, 820, 0.0011)
	bubble.position = Vector3(0, 0.98, 0)
	body.add_child(bubble)
	mic_icon = Pill.new(30, 400, 0.0011)
	mic_icon.position = Vector3(0, 0.86, 0)
	body.add_child(mic_icon)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-55, 35, 0)
	sun.light_energy = 0.9
	add_child(sun)
	talk = Talk.new()
	add_child(talk)
	var p := AudioStreamPlayer3D.new()
	p.unit_size = 3.0
	p.volume_db = 4.0
	p.max_db = 6.0
	p.position = Vector3(0, 0.62, 0)
	body.add_child(p)
	talk.player = p
	talk.mode_fn = func(): return "real&guide=1" if real else "demo"
	talk.state_changed.connect(_on_talk_state)
	talk.replied.connect(_on_reply)
	talk.level.connect(func(v): talk_level = v)

## put him 1.3 m in front of you, facing you, switch passthrough on, say hello
func begin(muse_link: Node, head: Node3D, capture: AudioEffectCapture, hands_free: bool) -> void:
	muse = muse_link
	cam = head
	talk.muse = muse
	talk.capture = capture
	talk.hands_free = hands_free
	var f := _flat(-cam.global_basis.z)
	if f.length() < 0.1:
		f = Vector3(0, 0, -1)
	body.global_position = _floor(cam.global_position) + f.normalized() * 1.3
	_face(cam.global_position, true)
	passthrough = set_passthrough(true)
	model.wave(2.4)
	if real:
		_say("Hi, I'm Baby Carpathron! " + ("Talk to me any time" if hands_free else "Hold the right grip and talk to me") + " — tell me where to go.\nSticks drive me, A / X stops me.", "happy", 9.0)
	else:
		_say("Hi, I'm Carpathron! Look around your room slowly so I can learn it. " + ("Then just talk to me." if hands_free else "Hold the right grip and talk to me."), "happy", 9.0)
	_start_camera()

func end() -> void:
	talk.interrupt()
	set_passthrough(false)
	if cam_plugin:
		cam_plugin.stop()

## Meta passthrough (needs the OpenXR vendors plugin): alpha blend = your real room behind everything
func set_passthrough(on: bool) -> bool:
	var xri := XRServer.find_interface("OpenXR")
	var ok := false
	if xri and xri.is_initialized():
		var modes: Array = xri.get_supported_environment_blend_modes()
		if on and modes.has(XRInterface.XR_ENV_BLEND_MODE_ALPHA_BLEND):
			ok = xri.set_environment_blend_mode(XRInterface.XR_ENV_BLEND_MODE_ALPHA_BLEND)
		elif not on:
			xri.set_environment_blend_mode(XRInterface.XR_ENV_BLEND_MODE_OPAQUE)
	get_viewport().transparent_bg = on and ok
	return ok

# ---------------------------------------------------------------- the headset camera -> Muse
func _start_camera() -> void:
	if Engine.has_singleton("CarpathronRoomCam"):
		cam_plugin = Engine.get_singleton("CarpathronRoomCam")
		var need := ["android.permission.CAMERA", "horizonos.permission.HEADSET_CAMERA"]
		var have := OS.get_granted_permissions()
		var missing := need.filter(func(x): return not have.has(x))
		if missing.is_empty():
			_open_camera()
		else:
			cam_status = "asking"
			for m in missing:
				OS.request_permission(m)
	elif room_image == "":
		cam_status = "no camera"

## Android answered a permission question
func on_permission(perm: String, granted: bool) -> void:
	if cam_plugin == null or not perm.ends_with("CAMERA"):
		return
	if not granted:
		cam_status = "camera not allowed"
		note.emit("Without the headset camera Carpathron can't see your room (Settings > Privacy > Camera)")
		return
	var have := OS.get_granted_permissions()
	if have.has("android.permission.CAMERA") and have.has("horizonos.permission.HEADSET_CAMERA"):
		_open_camera()

## the left passthrough camera (Meta metadata: source 0 = passthrough, position 0 = left); if its picture stays
## black, the next camera is tried
func _open_camera() -> void:
	cam_info = str(cam_plugin.camInfo())
	var ids := cam_info.split(",", false)
	if _cam_try == 0:
		cam_index = 0
		for i in ids.size():
			if ids[i].ends_with(":0/0"):
				cam_index = i
				break
	cam_status = cam_plugin.start(cam_index)
	_black_since = 0
	print("CARPATHRON_CAM ", JSON.stringify({"cameras": cam_info, "using": cam_index, "status": cam_status}))

func _camera_watchdog() -> void:
	if cam_plugin == null or cam_status != "on" or cam_luma < 0.0:
		return
	var now := Time.get_ticks_msec()
	if cam_luma > 0.03:
		_black_since = 0
		return
	if _black_since == 0:
		_black_since = now
	elif now - _black_since > 4000 and _cam_try < 4:
		var n := maxi(1, cam_info.split(",", false).size())
		_cam_try += 1
		cam_plugin.stop()
		cam_index = (cam_index + 1) % n
		cam_luma = -1.0
		_open_camera()

## the newest headset camera picture as a texture, ~3 per second (for the PC view: Robots > Live)
func _update_view_tex() -> void:
	var now := Time.get_ticks_msec()
	if now < _view_at:
		return
	_view_at = now + 300
	var jpg := PackedByteArray()
	if cam_plugin:
		var f: int = cam_plugin.frames()
		if f == _view_frames or cam_plugin.ageMs() > 2000:
			return
		_view_frames = f
		jpg = cam_plugin.grab()
	elif room_image != "" and view_tex == null:
		jpg = FileAccess.get_file_as_bytes(room_image)
	if jpg.size() < 200:
		return
	var img := Image.new()
	if img.load_jpg_from_buffer(jpg) != OK:
		return
	view_img = img
	var small := img.duplicate() as Image
	small.resize(8, 6)
	var lsum := 0.0
	for yy in 6:
		for xx in 8:
			lsum += small.get_pixel(xx, yy).get_luminance()
	cam_luma = lsum / 48.0
	if view_tex == null or view_tex.get_size() != Vector2(img.get_size()):
		view_tex = ImageTexture.create_from_image(img)
	else:
		view_tex.update(img)

func _send_eyes() -> void:
	var now := Time.get_ticks_msec()
	if now < next_eyes or muse == null or muse.state != "linked":
		return
	next_eyes = now + (700 if not nav.is_empty() else 1100)
	var jpg := PackedByteArray()
	if cam_plugin:
		cam_status = cam_plugin.status()
		if cam_plugin.ageMs() > 3000:
			return
		jpg = cam_plugin.grab()
	elif room_image != "":
		jpg = FileAccess.get_file_as_bytes(room_image)
	if jpg.size() < 200:
		return
	frame_id += 1
	if muse.post_eyes(jpg, frame_id):
		poses[frame_id] = cam.global_transform
		poses.erase(frame_id - 40)

## what Muse recognised in a headset picture -> markers in the room where those things are
func _update_anchors() -> void:
	var rv = muse.state_data.get("room", null)
	if typeof(rv) != TYPE_DICTIONARY:
		return
	var at := int(rv.get("at", 0))
	if at == last_seen:
		return
	last_seen = at
	var fid := int(rv.get("frame", -1))
	var pose = poses.get(fid)
	if pose == null:
		return
	var tf: Transform3D = pose
	var th := tan(deg_to_rad(HFOV / 2.0))
	var tv := th * 0.75
	for o in rv.get("seen", []):
		var b: Array = o.get("box", [0, 0, 0, 0])
		var label := str(o.get("label", "thing"))
		var kind := str(o.get("kind", "item"))
		var u := float(b[0]) + float(b[2]) / 2.0
		var v := float(b[1]) + float(b[3]) / 2.0
		var d := clampf(float(o.get("dist", 1.5)), 0.3, 6.0)
		var dir := tf.basis * Vector3((u - 0.5) * 2.0 * th, -(v - 0.5) * 2.0 * tv, -1.0).normalized()
		var p: Vector3 = tf.origin + dir * d
		# things standing on the floor: where the bottom of the box meets the floor is much more exact
		var on_floor := kind in ["human", "animal", "obstacle", "furniture", "door"] or "car" in label.to_lower() or "robot" in label.to_lower()
		if on_floor:
			var vb := float(b[1]) + float(b[3])
			var db := tf.basis * Vector3((u - 0.5) * 2.0 * th, -(vb - 0.5) * 2.0 * tv, -1.0).normalized()
			if db.y < -0.05:
				var t := -tf.origin.y / db.y
				if t > 0.2 and t < 7.0:
					var fp := tf.origin + db * t
					p = Vector3(fp.x, p.y if kind != "obstacle" and not ("car" in label.to_lower()) else 0.05, fp.z) if kind in ["human", "furniture", "door"] else Vector3(fp.x, 0.05, fp.z)
		_anchor(label, kind, p, float(o.get("dist", 0)), fid)

func _anchor(label: String, kind: String, p: Vector3, dist: float, frame := 0) -> void:
	var key := label.to_lower()
	var a = anchors.get(key)
	if a != null and (a["pos"] as Vector3).distance_to(p) < 1.3:
		a["pos"] = (a["pos"] as Vector3).lerp(p, 0.35)
		a["n"] = int(a["n"]) + 1
	else:
		if a != null:
			(a["node"] as Node3D).queue_free()
		if anchors.size() >= 14:
			# forget the oldest
			var old := ""; var t := INF
			for k in anchors:
				if float(anchors[k]["at"]) < t:
					t = float(anchors[k]["at"]); old = k
			(anchors[old]["node"] as Node3D).queue_free()
			anchors.erase(old)
		a = {"pos": p, "kind": kind, "n": 1, "node": _marker(label, kind)}
		anchors[key] = a
	a["at"] = Time.get_ticks_msec()
	a["dist"] = dist
	a["frame"] = frame
	if _is_car(key):
		a["pos"] = p    # the car moves: always the newest place
	(a["node"] as Node3D).global_position = a["pos"]

## a marker in the room: a small glowing dot, a hair-thin stem and a name tag above it
func _marker(label: String, kind: String) -> Node3D:
	var col: Color = COLORS.get(kind, COLORS["item"])
	var n := Node3D.new()
	add_child(n)
	var dot := MeshInstance3D.new()
	var sm := SphereMesh.new(); sm.radius = 0.018; sm.height = 0.036; sm.radial_segments = 12; sm.rings = 6
	dot.mesh = sm
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.albedo_color = col
	m.no_depth_test = true
	dot.material_override = m
	n.add_child(dot)
	var ring := MeshInstance3D.new()
	var tm := TorusMesh.new(); tm.inner_radius = 0.028; tm.outer_radius = 0.034; tm.rings = 24; tm.ring_segments = 6
	ring.mesh = tm
	var rm := m.duplicate() as StandardMaterial3D
	rm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	rm.albedo_color = Color(col.r, col.g, col.b, 0.5)
	ring.material_override = rm
	ring.rotation_degrees.x = 90
	ring.name = "ring"
	n.add_child(ring)
	var stem := MeshInstance3D.new()
	var cm := CylinderMesh.new(); cm.top_radius = 0.0016; cm.bottom_radius = 0.0016; cm.height = 0.1; cm.radial_segments = 6
	stem.mesh = cm
	var stm := m.duplicate() as StandardMaterial3D
	stm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	stm.albedo_color = Color(col.r, col.g, col.b, 0.55)
	stem.material_override = stm
	stem.position.y = 0.06
	n.add_child(stem)
	var tag := Pill.new(26, 500, 0.0009)
	tag.accent = col
	tag.text = label.capitalize()
	tag.position.y = 0.15
	tag.name = "tag"
	n.add_child(tag)
	return n

func find_anchor(name: String) -> Variant:
	var q := name.to_lower().strip_edges()
	if q == "":
		return null
	if anchors.has(q):
		return anchors[q]
	for k in anchors:
		if q in k or k in q:
			return anchors[k]
	for w in q.split(" "):
		if w.length() > 2:
			for k in anchors:
				if w in k:
					return anchors[k]
	return null

# ---------------------------------------------------------------- talking
func _on_talk_state(s: String) -> void:
	match s:
		"listening":
			mic_icon.set_accent(Color(1.0, 0.4, 0.38))
			mic_icon.text = "listening..."
			_face(cam.global_position, false)
		"thinking":
			mic_icon.set_accent(Color(0.75, 0.65, 1.0))
			mic_icon.text = "thinking..."
		_:
			mic_icon.text = ""

func _on_reply(j: Dictionary) -> void:
	mood = str(j.get("mood", "happy"))
	last_reply = j
	print("CARPATHRON_TALK ", JSON.stringify({"heard": j.get("heard", ""), "say": j.get("say", ""), "action": j.get("action", ""), "audio": (j.get("audio", []) as Array).size() if typeof(j.get("audio", [])) == TYPE_ARRAY else 0, "error": j.get("error", "")}))
	if j.has("error"):
		_say(str(j.get("say", "")), "sorry", 8.0)
		note.emit(str(j.get("say", "")))
		return
	var heard := str(j.get("heard", ""))
	note.emit(("You: " + heard + "\n") if heard != "" else "")
	_say(str(j.get("say", "")), mood, 4.0 + str(j.get("say", "")).length() * 0.06)
	do_action(str(j.get("action", "none")), str(j.get("target", "")), float(j.get("amount", 0)), j)

func _say(text: String, m: String, secs: float) -> void:
	bubble.text = text
	bubble.alpha = 1.0
	bubble_t = secs
	mood = m
	var c: Color = MOOD_EYES.get(m, MOOD_EYES["happy"])
	if model.glow:
		model.glow.albedo_color = c
		model.glow.emission = c

## the actions the companion brain chose (demo: this 3D Carpathron does them; real: the car does, he reacts)
func do_action(a: String, tgt: String, amount: float, j := {}) -> void:
	if real and a in ["goto", "come", "follow"]:
		var tgt_p = null
		if a == "come" or a == "follow":
			tgt_p = _in_front_of_user(0.55)
		elif tgt == "there":
			tgt_p = _gaze_floor(3.0)
		else:
			var an = find_anchor(tgt)
			if an != null:
				tgt_p = _floor(an["pos"])
				_highlight(an)
		if tgt_p == null:
			# the headset has not seen it: the car looks for it with its own camera (Muse mission)
			muse.mission("find", tgt)
			note.emit("Baby Carpathron is looking for the " + tgt + " with his camera")
			return
		nav_start(tgt_p, tgt if a == "goto" else "you", a == "follow")
		return
	if real and a not in ["none", "look", "outline", "wave"]:
		model.nod()
		if str(j.get("doing", "")) != "":
			note.emit("The car: " + str(j["doing"]))
		return
	match a:
		"stop", "stay":
			behaviour = "idle"; spin_left = 0.0; dance_t = 0.0
		"come":
			_walk_to(_in_front_of_user(NEAR_USER), "wave")
		"follow":
			behaviour = "follow"
		"goto":
			var an = find_anchor(tgt)
			if an != null:
				var p := _floor(an["pos"])
				var me := _floor(body.global_position)
				var d := me.distance_to(p)
				_walk_to(p + (me - p).normalized() * minf(0.45, d * 0.5) if d > 0.05 else p, "point")
				_highlight(an)
			else:
				_walk_to(_gaze_floor(2.0), "look")
		"forward", "back":
			var f := _flat(-body.global_basis.z).normalized()
			var m := clampf(absf(amount) if amount != 0.0 else 0.5, 0.1, 2.5)
			_walk_to(body.global_position + f * (m if a == "forward" else -m), "", a == "back")
		"left", "right":
			var deg := clampf(absf(amount) if amount != 0.0 else 90.0, 10.0, 360.0)
			turn_goal = body.rotation.y + deg_to_rad(deg) * (1.0 if a == "left" else -1.0)
			behaviour = "idle"
		"spin":
			spin_left = TAU
		"dance":
			dance_t = 4.0; behaviour = "idle"
		"wave":
			model.wave(2.6)
		"look", "explore", "scan":
			# a little look around the room (turn left, right, back to you)
			spin_left = TAU * (0.5 if a == "look" else 1.0)
		"outline":
			var an2 = find_anchor(tgt)
			if an2 != null:
				_highlight(an2)
				_face(an2["pos"], false)
			model.nod()
		"none":
			pass   # just talking: no nodding on every answer
		_:
			model.nod()

func _highlight(an: Dictionary) -> void:
	highlight = an["node"]
	highlight_t = 5.0

## the sticks walk him (v forward -1..1, w turn -1..1, + = left)
func manual(v: float, w: float) -> void:
	man_v = v; man_w = w
	if absf(v) > 0.05 or absf(w) > 0.05:
		behaviour = "idle"; spin_left = 0.0; dance_t = 0.0; turn_goal = NAN

## point at the floor + trigger: walk there
func tap_floor(p: Vector3) -> void:
	if real:
		return
	_walk_to(p, "")
	model.nod()

func _walk_to(p: Vector3, then: String, backwards := false) -> void:
	var me := _floor(cam.global_position)
	var t := _floor(p)
	if t.distance_to(me) > MAX_RANGE:
		t = me + (t - me).normalized() * MAX_RANGE
	if t.distance_to(me) < 0.45:
		t = me + (t - me).normalized() * 0.45 if (t - me).length() > 0.01 else me + _flat(-cam.global_basis.z).normalized() * 0.6
	target = t
	after = then
	behaviour = "back" if backwards else "walk"

# ---------------------------------------------------------------- helpers
func _floor(p: Vector3) -> Vector3:
	return Vector3(p.x, 0.0, p.z)

func _flat(v: Vector3) -> Vector3:
	return Vector3(v.x, 0.0, v.z)

func _in_front_of_user(d: float) -> Vector3:
	var f := _flat(body.global_position - cam.global_position)
	if f.length() < 0.2:
		f = _flat(-cam.global_basis.z)
	return _floor(cam.global_position) + f.normalized() * d

## where you look, on the floor (at most max_d away)
func _gaze_floor(max_d: float) -> Vector3:
	var o := cam.global_position
	var d := -cam.global_basis.z
	if d.y < -0.08:
		var t := -o.y / d.y
		var hit := o + d * t
		if _flat(hit - o).length() <= max_d:
			return hit
	return _floor(o) + _flat(d).normalized() * max_d

func _face(p: Vector3, now: bool) -> void:
	var to := _flat(p - body.global_position)
	if to.length() < 0.05:
		return
	var yaw := atan2(-to.x, -to.z)
	if now:
		body.rotation.y = yaw
	else:
		turn_goal = yaw

# ---------------------------------------------------------------- every frame
func _process(delta: float) -> void:
	if cam == null:
		return
	model.visible = not real
	shadow.visible = not real
	_send_eyes()
	_update_view_tex()
	_camera_watchdog()
	if muse:
		_update_anchors()
	if real:
		_sim_car_step(delta)
		_nav_step(delta)
		# Baby Carpathron (the real car) is the companion: no 3D robot; his words and voice above the real car when
		# the headset sees him, otherwise at his camera window
		var car = _car()
		body.global_position = (car["pos"] as Vector3) + Vector3(0, 0.32, 0) if car != null else car_anchor
		var to := _flat(cam.global_position - body.global_position)
		if to.length() > 0.05:
			body.rotation.y = atan2(-to.x, -to.z)
		bubble.position = Vector3(0, 0.02, 0)
		mic_icon.position = Vector3(0, -0.08, 0)
		if bubble_t > 0.0:
			bubble_t -= delta
			bubble.alpha = clampf(bubble_t / 0.6, 0.0, 1.0)
		return
	bubble.position = Vector3(0, 0.98, 0)
	mic_icon.position = Vector3(0, 0.86, 0)
	if muse and muse.state == "linked" and not muse.has_companion() and not _warned_old:
		_warned_old = true
		_say("Please install Muse Carpathron 2.3.0 on your PC — then I can hear you, talk and see your room.", "sorry", 12.0)
		note.emit("Muse Carpathron on the PC is " + muse.version + ": install 2.3.0 for the companion")
	if muse:
		muse.want_vision = true
		muse.vision_src = "room"
	var v := 0.0
	var w := 0.0
	var me := _floor(body.global_position)
	if absf(man_v) > 0.05 or absf(man_w) > 0.05:
		body.rotation.y += man_w * 2.2 * delta
		var np := body.global_position + _flat(-body.global_basis.z).normalized() * man_v * SPEED * delta
		if _floor(np).distance_to(_floor(cam.global_position)) < MAX_RANGE + 1.0:
			body.global_position = np
		v = man_v; w = man_w
	elif behaviour == "follow":
		var dist := me.distance_to(_floor(cam.global_position))
		if dist > NEAR_USER + 0.45:
			target = _in_front_of_user(NEAR_USER)
			after = ""
			v = _step_to(target, delta)
		else:
			_face(cam.global_position, false)
	elif behaviour == "walk" or behaviour == "back":
		v = _step_to(target, delta, behaviour == "back")
		if absf(v) < 0.001 and me.distance_to(target) < 0.08:
			behaviour = "idle"
			match after:
				"wave": model.wave(2.0); _face(cam.global_position, false)
				"point": model.wave(1.6); model.nod()
				"look": spin_left = PI
			after = ""
	if spin_left > 0.0:
		var r := minf(spin_left, 3.2 * delta)
		body.rotation.y += r
		spin_left -= r
		w = 1.0
		if spin_left <= 0.0:
			_face(cam.global_position, false)
	elif dance_t > 0.0:
		dance_t -= delta
		body.rotation.y += sin(dance_t * 6.0) * 2.4 * delta
		model.root.position.y = absf(sin(dance_t * 8.0)) * 0.05
		w = sin(dance_t * 6.0)
		if int(dance_t * 2.0) % 3 == 0:
			model.wave(0.3)
		if dance_t <= 0.0:
			_face(cam.global_position, false)
	elif behaviour == "idle" and is_nan(turn_goal) and absf(man_v) < 0.05 and absf(man_w) < 0.05:
		# idle: turn to face you when you walk around him
		var to := _flat(cam.global_position - body.global_position)
		var want := atan2(-to.x, -to.z)
		if absf(wrapf(want - body.rotation.y, -PI, PI)) > 0.6:
			turn_goal = want
	if not is_nan(turn_goal):
		var diff := wrapf(turn_goal - body.rotation.y, -PI, PI)
		var r2 := clampf(diff, -2.6 * delta, 2.6 * delta)
		body.rotation.y += r2
		w = signf(diff) * 0.7
		if absf(diff) < 0.03:
			turn_goal = NAN
	v_now = lerpf(v_now, v, minf(1.0, delta * 6.0))
	w_now = lerpf(w_now, w, minf(1.0, delta * 6.0))
	model.animate(delta, v_now, w_now)
	# speaking: eyes glow with the voice, head looks up at you
	if model.glow:
		model.glow.emission_energy_multiplier = 1.2 + talk_level * 3.0
	if talk.state == "speaking":
		model.head.rotation.x = lerpf(model.head.rotation.x, -0.12 - talk_level * 0.08, minf(1.0, delta * 10.0))
	# speech bubble fades
	if bubble_t > 0.0:
		bubble_t -= delta
		bubble.alpha = clampf(bubble_t / 0.6, 0.0, 1.0)
	# highlighted marker pulses
	if highlight != null and is_instance_valid(highlight):
		highlight_t -= delta
		var ring: Node3D = highlight.get_node_or_null("ring")
		if ring:
			var k := 1.0 + 0.8 * absf(sin(highlight_t * 4.0)) if highlight_t > 0.0 else 1.0
			ring.scale = Vector3.ONE * k
		if highlight_t <= 0.0:
			highlight = null
	# the markers turn to you
	for k2 in anchors:
		var n: Node3D = anchors[k2]["node"]
		var ring2: Node3D = n.get_node_or_null("ring")
		if ring2:
			ring2.look_at(cam.global_position, Vector3.UP, true)
			ring2.rotate_object_local(Vector3.RIGHT, PI / 2.0)

## walk towards p: turn first, then walk; returns the forward speed -1..1
func _step_to(p: Vector3, delta: float, backwards := false) -> float:
	var to := _flat(p - body.global_position)
	var d := to.length()
	if d < 0.06:
		return 0.0
	var yaw := atan2(-to.x, -to.z) + (PI if backwards else 0.0)
	var diff := wrapf(yaw - body.rotation.y, -PI, PI)
	body.rotation.y += clampf(diff, -3.0 * delta, 3.0 * delta)
	if absf(diff) > 0.5:
		return 0.0
	var sp := SPEED * clampf(d / 0.35, 0.3, 1.0) * (0.6 if backwards else 1.0)
	var step := minf(d, sp * delta)
	body.global_position += to.normalized() * step
	return (sp / SPEED) * (-1.0 if backwards else 1.0)


# ---------------------------------------------------------------- guided driving (real Baby Carpathron)
func _is_car(key: String) -> bool:
	return key == "robot car" or ("robot" in key and "car" in key) or key == "baby carpathron"

## the real car as the headset sees it (fresh: seen in the last 12 s)
func _car() -> Variant:
	for k in anchors:
		if _is_car(k) and Time.get_ticks_msec() - int(anchors[k]["at"]) < 12000:
			return anchors[k]
	return null

func nav_active() -> bool:
	return not nav.is_empty()

func nav_wheels() -> Vector2:
	if nav.is_empty() or Time.get_ticks_msec() > int(nav.get("until", 0)):
		return Vector2.ZERO
	return nav.get("wheels", Vector2.ZERO)

func nav_stop(why := "") -> void:
	if nav.is_empty():
		return
	nav = {}
	if why != "":
		note.emit("Guided driving stopped (" + why + ")")

func nav_start(goal: Vector3, what: String, follow := false) -> void:
	nav = {"goal": _floor(goal), "what": what, "follow": follow, "phase": "find", "t": Time.get_ticks_msec(), "steps": 0, "heading": null}
	note.emit("Driving Baby Carpathron to the " + what + ": the headset guides him")
	print("CARPATHRON_NAV ", JSON.stringify({"start": what, "goal": [goal.x, goal.z]}))

func _wheels(l: int, r: int, ms: float) -> void:
	nav["wheels"] = Vector2(l, r)
	nav["until"] = Time.get_ticks_msec() + int(ms)

## a new sighting of the car taken after the last move ended
func _car_after(frame: int) -> Variant:
	var c = _car()
	if c != null and int(c.get("frame", 0)) > frame:
		return c
	return null

func _nav_step(_delta: float) -> void:
	if nav.is_empty():
		return
	var now := Time.get_ticks_msec()
	if now < int(nav.get("until", 0)) + 250:
		return   # wheels still turning (plus a short settle)
	if nav.has("until"):
		# a move just ended: wait for a picture taken after it
		nav.erase("until")
		nav["after_frame"] = frame_id
		nav["wait_since"] = now
		return
	if nav["follow"]:
		nav["goal"] = _in_front_of_user(0.55)
	var waiting := nav.has("after_frame")
	var c = _car_after(int(nav.get("after_frame", -1))) if waiting else _car()
	if c == null:
		var since := now - int(nav.get("wait_since", nav["t"]))
		if since > 9000:
			nav_stop("can't see Baby Carpathron — look at him so the headset finds him")
			_say("I can't see myself from your headset. Look at me for a moment and ask again.", "sorry", 6.0)
		return
	nav.erase("after_frame")
	var p: Vector3 = _floor(c["pos"])
	var goal: Vector3 = nav["goal"]
	var to := goal - p
	var dist := to.length()
	# where he faces: from the last forward move
	if nav.has("p_before") and nav.get("moved_fwd", false):
		var mv: Vector3 = p - (nav["p_before"] as Vector3)
		if mv.length() > 0.06:
			nav["heading"] = mv.normalized()
			var secs := float(nav.get("fwd_ms", 600)) / 1000.0
			car_speed = clampf(lerpf(car_speed, mv.length() / maxf(0.2, secs), 0.5), 0.1, 0.8)
	nav["moved_fwd"] = false
	print("CARPATHRON_NAV ", JSON.stringify({"car": [p.x, p.z], "dist": snappedf(dist, 0.01), "heading": nav.get("heading") != null, "speed": snappedf(car_speed, 0.01), "steps": nav["steps"]}))
	if dist < 0.45:
		var what: String = nav["what"]
		var follow: bool = nav["follow"]
		if follow:
			nav["wait_since"] = now; nav["t"] = now; nav["steps"] = 0
			return
		nav_stop()
		_say("Here I am!" if what == "you" else "I'm at the " + what + "!", "happy", 4.0)
		return
	nav["steps"] = int(nav["steps"]) + 1
	if int(nav["steps"]) > 9:
		nav_stop("too many tries")
		return
	nav["p_before"] = p
	if nav.get("heading") == null:
		# don't know where he faces yet: a short drive forward shows it
		nav["moved_fwd"] = true
		nav["fwd_ms"] = 700.0
		_wheels(60, 60, 700)
		return
	var h: Vector3 = nav["heading"]
	var ang := atan2(h.cross(to).y, h.dot(to))      # + = the goal is on his left
	if absf(ang) > deg_to_rad(18):
		var ms := absf(ang) / TAU * CAR_TURN_MS360
		if ang > 0:
			_wheels(-70, 70, ms)
		else:
			_wheels(70, -70, ms)
		nav["heading"] = h.rotated(Vector3.UP, ang)
		nav["p_before"] = null
		nav.erase("p_before")
		return
	var go := clampf(dist - 0.3, 0.1, 1.2)
	var fms := go / car_speed * 1000.0
	nav["moved_fwd"] = true
	nav["fwd_ms"] = fms
	_wheels(60, 60, fms)


# ---------------------------------------------------------------- test: a simulated car seen by the "headset"
var sim_car := {}   # {pos, yaw, speed(m/s at 60), next} — moves with the wheel commands, reported like the camera does

func _sim_car_step(delta: float) -> void:
	if sim_car.is_empty():
		return
	var wv := nav_wheels()
	var lin := (wv.x + wv.y) / 2.0 / 60.0 * float(sim_car["speed"])
	var rot := (wv.y - wv.x) / 140.0 * TAU / (CAR_TURN_MS360 / 1000.0)
	sim_car["yaw"] = float(sim_car["yaw"]) + rot * delta
	var f := Vector3(-sin(sim_car["yaw"]), 0, -cos(sim_car["yaw"]))
	sim_car["pos"] = (sim_car["pos"] as Vector3) + f * lin * delta
	var now := Time.get_ticks_msec()
	if now >= int(sim_car["next"]):
		sim_car["next"] = now + 700
		frame_id += 1
		var noise := Vector3(randf_range(-0.04, 0.04), 0, randf_range(-0.04, 0.04))
		_anchor("robot car", "obstacle", (sim_car["pos"] as Vector3) + noise, 1.0, frame_id)
