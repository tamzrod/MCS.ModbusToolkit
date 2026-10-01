(() => {
  const root = document.getElementById('diagnostics-results');
  const refresh = document.getElementById('diagnostics-refresh');
  const copy = document.getElementById('diagnostics-copy');
  const status = document.getElementById('diagnostics-time');
  let report = null;
  const element = (tag, text) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const section = title => {
    const node = element('section'); node.className = 'diagnostics-section';
    node.append(element('h2', title)); root.append(node); return node;
  };
  const draw = snapshot => {
    root.replaceChildren();
    const problems = section('Problems');
    const list = element('ul');
    for (const problem of snapshot.problems) list.append(element('li', problem));
    if (!snapshot.problems.length) list.append(element('li', 'No problems detected by these checks. This is not an end-to-end communication test.'));
    problems.append(list);
    section('Services').append(element('p', Object.entries(snapshot.services).map(([name, state]) => `${name}: ${state}`).join(' | ') || 'Live service checks disabled.'));
    const ports = section('Ports');
    const table = element('table');
    const header = element('tr');
    for (const title of ['Purpose', 'Configured address', 'Unit IDs', 'Observation', 'Actual address / PID / process']) header.append(element('th', title));
    table.append(header);
    for (const port of snapshot.ports) {
      const row = element('tr');
      const owners = port.owners.map(owner => `${owner.address}:${owner.port} / ${owner.pid} / ${owner.process || 'Unknown'}`).join('\n');
      for (const value of [port.kind, port.listen || '(empty)', port.units, port.state, owners || '—']) row.append(element('td', value));
      table.append(row);
    }
    ports.append(table, element('p', snapshot.note));
    if (!snapshot.ports.length) ports.append(element('p', 'No listeners configured.'));
    const logs = section('Backend logs');
    logs.append(element('p', 'Latest 64 KiB per stream. Historical records, not a current health verdict. Refresh to reload.'));
    const source = element('select'); source.setAttribute('aria-label', 'Log source');
    const all = element('option', 'All sources'); all.value = ''; source.append(all);
    snapshot.logs.forEach(entry => { const option = element('option', entry.source); option.value = entry.source; source.append(option); });
    const search = element('input'); search.type = 'search'; search.placeholder = 'Filter log text'; search.setAttribute('aria-label', 'Filter log text');
    const output = element('pre'); output.className = 'diagnostics-log';
    const filter = () => {
      output.textContent = snapshot.logs.filter(entry => !source.value || entry.source === source.value).map(entry => {
        const lines = (entry.unavailable || entry.text || '(No output)').split('\n').filter(line => !search.value || line.toLowerCase().includes(search.value.toLowerCase()));
        return lines.length ? `--- ${entry.source} ---\n${lines.join('\n')}` : '';
      }).filter(Boolean).join('\n\n') || 'No matching log lines.';
    };
    source.addEventListener('change', filter); search.addEventListener('input', filter);
    logs.append(source, search, output); filter();
  };
  const load = async () => {
    if (refresh.disabled) return;
    refresh.disabled = true; copy.disabled = true; report = null;
    root.replaceChildren(); status.textContent = 'Collecting read-only checks…';
    try {
      report = await window.mcsDesktop.getDiagnostics();
      draw(report); copy.disabled = false;
      status.textContent = `Snapshot: ${new Date(report.at).toLocaleString()} — refresh for current evidence`;
    } catch (error) { status.textContent = `Diagnostics unavailable: ${error.message || error}`; }
    finally { refresh.disabled = false; }
  };
  refresh.addEventListener('click', load);
  document.querySelector('[data-tab="diagnostics"]').addEventListener('click', load);
  copy.addEventListener('click', async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      status.textContent = 'Report copied. Review IP addresses and log contents before sharing.';
    } catch (error) { status.textContent = `Could not copy report: ${error.message}`; }
  });
})();
