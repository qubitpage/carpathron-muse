// Robot → Control → 🗺 Room map card: what the car has learned about the room so far, and a button to the Map tab
// (the 3D map where you put the robot, name places and send it somewhere).
const ui = () => window.MCui;
async function render(el) {
  const { h, api } = ui();
  const v = await api('/api/robot/roommap').catch(() => null);
  el.innerHTML = '';
  const st = v ? v.stats : { freeM2: 0, wallM: 0 };
  el.append(h('h3', {}, '🗺 Room map'),
    h('p', { class: 'small muted' }, v && st.freeM2 > 0.3
      ? `The car has learned ${st.freeM2} m² of floor and ${st.wallM} m of walls and furniture${v.places.length ? `, and knows ${v.places.length} place${v.places.length > 1 ? 's' : ''} (${v.places.map((p) => p.name).join(', ')})` : ''}.`
      : 'The car learns the room with its laser while it drives. Open the map to let it explore by itself, then send it anywhere with one click.'),
    h('button', { class: 'btn primary wide', onclick: () => ui().openRobot('map') }, '🗺 Open the room map'));
}
window.MC3d = { render };
const tryRender = () => { const el = document.getElementById('plan3dCard'); if (window.MCui && el) { render(el); setInterval(() => { if (el.offsetParent) render(el); }, 15000); } else setTimeout(tryRender, 400); };
tryRender();
