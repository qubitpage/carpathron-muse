// Tool routing: send the model only the tools a conversation needs.
// Every request used to carry all ~95 tool definitions (~40 KB, ~10k tokens). Fewer tools make each step faster and
// cheaper and help the model pick the right one. A small core set is always offered; groups are added when the
// conversation needs them (keywords in the user's messages or skills, the remote server it works on, tools it already
// used) or when the model asks for them with load_tools. Tools that are not offered still run if the model calls them.
'use strict';

const GROUPS = {
  ssh: { about: 'remote servers over SSH: ssh_servers, ssh_exec, ssh_shell, ssh_upload, ssh_download, ssh_key, ssh_save_server', tools: /^ssh_/, words: /\b(ssh|server|servers|vps|deploy|deployment|nginx|apache|caddy|ubuntu|debian|linux box|droplet|hosting|upload to|remote host|raspberry pi|jetson)\b/i },
  documents: { about: 'documents and pages: read_document (PDF/Word/Excel/PowerPoint), create_pdf, view_image, screenshot_page', tools: /^(read_document|create_pdf|view_image|screenshot_page)$/, words: /\b(pdf|docx?|word document|excel|xlsx|spreadsheet|powerpoint|pptx|slides|invoice|report|cv|resume|flyer|screenshot|website|web ?page|landing page|html|css|design)\b/i },
  research: { about: 'web research: web_search, deep_research', tools: /^(web_search|deep_research)$/, words: /\b(search|research|look up|find out|latest|news|compare|sources?|cite|web)\b/i },
  media: { about: 'Meta media models: generate_image (Muse Image), segment_image (SAM 3.1), transcribe_audio (Muse Voice Transcribe)', tools: /^(generate_image|segment_image|transcribe_audio)$/, words: /\b(image|images|picture|photo|logo|illustration|draw|generate an? |segment|sam\b|mask|objects? in|audio|voice|transcri\w*|recording|mp3|wav)\b/i },
  firmware: { about: 'Arduino / ESP32 firmware: arduino_setup, arduino_boards, arduino_compile, arduino_upload, serial_monitor, arduino_cli, open_arduino_ide', tools: /^(arduino_|serial_monitor|open_arduino_ide)/, words: /\b(arduino|esp32|esp8266|firmware|sketch|\.ino|flash|serial|com\d+|microcontroller|board)\b/i },
  hardware: { about: 'dev setup and boards: dev_environment, dev_install, open_ide, micropython, pico_flash, sd_card_image (Raspberry Pi, Pico, NVIDIA/CUDA, Jetson)', tools: /^(dev_environment|dev_install|open_ide|micropython|pico_flash|sd_card_image)$/, words: /\b(raspberry|pico|micropython|jetson|nvidia|cuda|gpu|sd card|ide|vs ?code|thonny|install (?:a |the )?tool|dev environment|nsight)\b/i },
  robot: { about: 'the Carpathron robot: robot_status, robot_goto (find something and drive to it), robot_drive, robot_stop, robot_look, robot_turn, robot_scan_room, robot_photo, robot_settings, robot_diagnose, board_pins, robot_say, robot_map (room map: go to a named place, explore)', tools: /^(robot_|board_pins$)/, words: /\b(robot|car|drive|forward|backward|turn left|turn right|camera|photo|look (?:left|right|around)|scan the room|room map|carpathron car|baby carpathron|go to|come to|find the|show me|where is|masina|robotul|du-te|mergi|health check|diagnos\w*|calibrat\w*|car settings|pins?|gpio|wiring|esp32|arduino|wheels?|speak|out loud|announce|map|explore|place|kitchen|door|patrol)\b/i },
  github: { about: 'GitHub: github_account, github_repos, github_create_repo, github_publish, github_clone, github_release, github_issues, github_pulls, github_api', tools: /^github_/, words: /\b(github|git hub|repo|repository|pull request|\bpr\b|issue|release|clone|push|publish)\b/i },
  computer: { about: 'see and control this PC: computer_view, computer_act (desktop apps), browser_view, browser_act (the Muse browser)', tools: /^(computer_|browser_)/, words: /\b(click|screen|desktop|window|open (?:the )?app|browser|log ?in|sign ?in|website form|type into|computer use|my pc)\b/i },
  security: { about: 'Carpathron Shield: shield_scan (project before publishing, server, website), shield_fix, shield_monitor; security_check', tools: /^(shield_|security_check$)/, words: /\b(secur\w*|shield|harden\w*|vulnerab\w*|firewall|fail2ban|attack|hack|leak|secret|exposed|ssl|tls|https|certificate|monitor|audit)\b/i },
  jobs: { about: 'background processes: job_start, job_output, job_stop (dev servers, long builds, watchers)', tools: /^job_/, words: /\b(server|dev server|npm run|watch|background|long[- ]running|serve|start the app|localhost|port \d+)\b/i },
};
// always offered (plus task_update, delegate, knowledge_search and MCP tools, which the agent adds itself)
const CORE = new Set(['list_dir', 'read_file', 'write_file', 'edit_file', 'search', 'run_command', 'web_fetch', 'ask_model', 'memory_save', 'memory_search', 'memory_forget', 'search_chats', 'task_update', 'delegate', 'knowledge_search', 'load_tools']);

const LOAD_TOOLS = {
  name: 'load_tools', risk: 'read',
  description: `Load more tools for this conversation. Only a core set (files, commands, web_fetch, memory, tasks) is loaded at first; load a group when you need its tools. Groups: ${Object.entries(GROUPS).map(([k, g]) => `${k} (${g.about})`).join('; ')}.`,
  parameters: { type: 'object', properties: { groups: { type: 'array', items: { type: 'string', enum: Object.keys(GROUPS) } } }, required: ['groups'] },
};

function groupOf(name) {
  for (const [k, g] of Object.entries(GROUPS)) if (g.tools.test(name)) return k;
  return null;
}

// Which groups this conversation needs. llm = the message history sent to the model.
function neededGroups(conv, llm) {
  const on = new Set(conv.toolGroups || []);
  if (conv.remote && conv.remote.serverId) { on.add('ssh'); on.add('jobs'); }
  const text = [];
  for (const m of llm || []) {
    if (m.role === 'user') text.push(typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map((p) => p.text || '').join(' ') : '');
    if (m.role === 'assistant' && Array.isArray(m.tool_calls)) for (const c of m.tool_calls) { const g = groupOf(c.function && c.function.name || ''); if (g) on.add(g); }
  }
  const all = text.join('\n').slice(-60000);
  for (const [k, g] of Object.entries(GROUPS)) {
    if (on.has(k)) continue;
    if (g.words.test(all)) { on.add(k); continue; }
    // a skill or the user named one of the group's tools
    if (new RegExp(`\\b(${String(g.tools.source).replace(/^\^|\$$/g, '').replace(/^\(|\)$/g, '')})\\w*`).test(all)) on.add(k);
  }
  return on;
}

// specs = every tool the agent has; returns the list to send this step.
// A small local model driving the robot gets only the robot tools plus a few basics: fewer choices, better picks.
const ROBOT_CORE = new Set(['memory_save', 'memory_search', 'task_update', 'load_tools']);

function route(specs, conv, llm, settings = {}, opts = {}) {
  if (settings.toolRouting === false) return specs.filter((t) => t.name !== 'load_tools');
  const on = neededGroups(conv, llm);
  // Small local models + the robot: words like "photo", "camera", "picture", "look" also match media / documents /
  // computer, which would offer ~50 tools and confuse the model. The robot wins; other groups stay only when the user
  // clearly asks for them (load_tools also still works).
  if (opts.local && on.has('robot')) for (const g of ['media', 'documents', 'computer', 'hardware', 'jobs']) if (!(conv.toolGroups || []).includes(g)) on.delete(g);
  const robotOnly = opts.local && on.size === 1 && on.has('robot');
  return specs.filter((t) => {
    if (robotOnly) return ROBOT_CORE.has(t.name) || groupOf(t.name) === 'robot';
    if (t._mcp) return true;              // tools from the user's MCP servers are always offered
    if (CORE.has(t.name)) return true;
    const g = groupOf(t.name);
    return g ? on.has(g) : true;          // unknown tools stay offered
  });
}

function loadTools(conv, groups) {
  const want = (Array.isArray(groups) ? groups : [groups]).map(String).filter((g) => GROUPS[g]);
  if (!want.length) return `Unknown group. Available: ${Object.keys(GROUPS).join(', ')}.`;
  conv.toolGroups = [...new Set([...(conv.toolGroups || []), ...want])];
  return `Loaded: ${want.map((g) => `${g} (${GROUPS[g].about})`).join('; ')}. These tools are available from your next step on.`;
}

module.exports = { GROUPS, CORE, LOAD_TOOLS, route, neededGroups, loadTools, groupOf };
