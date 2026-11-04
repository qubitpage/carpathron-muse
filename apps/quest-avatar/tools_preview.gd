extends SceneTree
## dev tool: renders the robot and the two controllers to PNGs (desktop). godot --path . --script tools_preview.gd -- out_dir
const RobotModel = preload("res://robot_model.gd")
const Ctrl = preload("res://controller_model.gd")
func _initialize() -> void:
	var out: String = OS.get_cmdline_user_args()[0]
	var w := Node3D.new(); root.add_child(w)
	var env := WorldEnvironment.new(); var e := Environment.new(); e.background_mode = Environment.BG_COLOR; e.background_color = Color(0.1, 0.11, 0.13)
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR; e.ambient_light_color = Color(0.55, 0.55, 0.6); env.environment = e; w.add_child(env)
	var sun := DirectionalLight3D.new(); sun.rotation_degrees = Vector3(-40, 25, 0); w.add_child(sun)
	var fill := OmniLight3D.new(); fill.position = Vector3(-1, 1.5, -1.5); fill.light_energy = 0.6; w.add_child(fill)
	var r := RobotModel.new(); r.rotation.y = PI; w.add_child(r)
	var cam := Camera3D.new(); cam.position = Vector3(0.25, 0.85, 1.05); w.add_child(cam); cam.look_at(Vector3(0, 0.7, 0))
	await process_frame; await process_frame
	r.wave(3.0)
	for i in 30: r.animate(1.0 / 30, 0, 0); await process_frame
	await RenderingServer.frame_post_draw
	root.get_viewport().get_texture().get_image().save_png(out + "/robot.png")
	cam.position = Vector3(0, 1.05, 0.42); cam.look_at(Vector3(0, 1.0, 0))
	await process_frame; await RenderingServer.frame_post_draw
	root.get_viewport().get_texture().get_image().save_png(out + "/robot-face.png")
	r.visible = false
	var cl := Ctrl.new(false); cl.position = Vector3(-0.07, 1.0, 0); w.add_child(cl)
	var cr := Ctrl.new(true); cr.position = Vector3(0.07, 1.0, 0); w.add_child(cr)
	cl.set_hints({"stick": "Drive / turn", "a": "STOP", "b": "Head steering", "menu": "Menu", "trigger": "Turbo", "grip": "What do you see?"})
	cr.set_hints({"stick": "Drive / turn", "a": "STOP", "b": "Photo", "trigger": "Turbo · select", "grip": "Talk to Muse"})
	cl.hints.visible = true; cr.hints.visible = true
	cr.update(Vector2(0.6, 0.5), true, false, false, 0.8, 0)
	cam.position = Vector3(0, 1.17, 0.26); cam.look_at(Vector3(0, 1.0, -0.03))
	await process_frame; await process_frame; await RenderingServer.frame_post_draw
	root.get_viewport().get_texture().get_image().save_png(out + "/controllers.png")
	quit()
