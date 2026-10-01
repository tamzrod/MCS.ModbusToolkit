(function(root) {
  const layers = [['network', 'Network'], ['tcp', 'TCP'], ['modbus', 'Modbus'], ['mma2', 'MMA2']];
  const seenEvents = new Map();
  const consumeActivity = (status, name, layer) => {
    let changed = false;
    for (const block of status && status.blocks || []) {
      const observation = block[layer];
      const stamp = observation && (layer === 'tcp' ? observation.activity_at : observation.last_success_at);
      if (!stamp || stamp.startsWith('0001-') || !Number.isFinite(Date.parse(stamp)) || observation.state !== 'OK') continue;
      const key = `${name}/${layer}/${block.index}/${observation.endpoint || ''}`;
      if (seenEvents.get(key) !== stamp) { seenEvents.set(key, stamp); changed = true; }
    }
    return changed;
  };
  const create = document => {
    const node = (tag, className, text) => {
      const element = document.createElement(tag);
      element.className = className;
      if (text !== undefined) element.textContent = text;
      return element;
    };
    const strip = node('div', 'comms-strip');
    strip.id = 'rep-comms';
    strip.setAttribute('aria-label', 'Selected device communications');
    for (const [heading, members] of [['SOURCE', layers.slice(0, 3)], ['DESTINATION', layers.slice(3)]]) {
      const group = node('div', 'comms-group');
      group.appendChild(node('span', 'comms-heading', heading));
      const indicators = node('div', 'comms-indicators');
      for (const [key, label] of members) {
        const item = node('div', 'comms-item');
        item.appendChild(node('span', 'comms-label', label));
        const button = node('button', 'comms-led');
        button.id = `rep-comms-${key}`;
        button.type = 'button';
        button.dataset.state = 'UNKNOWN';
        button.setAttribute('aria-label', `${label}: unknown`);
        button.setAttribute('aria-describedby', `${button.id}-detail`);
        button.setAttribute('aria-expanded', 'false');
        const detail = node('div', 'comms-tooltip', `${label}: not tested`);
        detail.id = `${button.id}-detail`;
        detail.setAttribute('role', 'tooltip');
        detail.hidden = true;
        const reveal = visible => {
          detail.hidden = !visible;
          button.setAttribute('aria-expanded', String(visible));
        };
        item.addEventListener('pointerenter', () => reveal(true));
        item.addEventListener('pointerleave', () => reveal(false));
        button.addEventListener('focus', () => reveal(true));
        button.addEventListener('blur', () => reveal(false));
        button.addEventListener('click', () => reveal(true));
        button.addEventListener('keydown', event => { if (event.key === 'Escape') reveal(false); });
        item.append(button, detail);
        indicators.appendChild(item);
      }
      group.appendChild(indicators);
      strip.appendChild(group);
    }
    return strip;
  };
  const viewModel = (status, name, reason = '') => {
    const usable = status && !status.unavailable && status.name === name && status.enabled && status.running;
    return Object.fromEntries(layers.map(([key, label]) => {
      const reported = usable && status.comms && status.comms[key];
      const state = ['OK', 'WARNING', 'ERROR'].includes(reported) ? reported : 'UNKNOWN';
      const lines = [`${label}: ${state.toLowerCase()}`, `Device: ${name || 'none'}`];
      if (!usable) lines.push(reason || 'Disabled, unavailable, stale or not tested');
      else if (!status.comms) lines.push('Runtime does not provide communication telemetry. Update and restart the Replicator backend.');
      else {
        const observations = key === 'network' ? [{observation: status.network}] : (status.blocks || []).map(block => ({block, observation: block[key]}));
        for (const {block, observation} of observations) {
          if (block) lines.push(`Block ${block.index + 1} / FC${block.function} / ${block.start} + ${block.count}`);
          if (!observation) { lines.push('Not tested'); continue; }
          lines.push(`${observation.endpoint || '-'}: ${observation.outcome || 'NOT_TESTED'}`);
          if (observation.exception_code !== undefined) lines.push(`Exception code: ${observation.exception_code}`);
          if (observation.error) lines.push(observation.error);
          if (observation.observed_at && !observation.observed_at.startsWith('0001-')) lines.push(`Observed: ${observation.observed_at}`);
        }
      }
      return [key, {state, detail: lines.join('\n'), label}];
    }));
  };
  const update = (strip, status, name, reason) => {
    if (!strip) return;
    const model = viewModel(status, name, reason);
    for (const [key, value] of Object.entries(model)) {
      const button = strip.querySelector(`#rep-comms-${key}`);
      const detail = strip.querySelector(`#rep-comms-${key}-detail`);
      if (!button || !detail) continue;
      button.dataset.state = value.state;
      button.setAttribute('aria-label', `${value.label}: ${value.state.toLowerCase()}`);
      detail.textContent = value.detail;
      if (value.state === 'OK' && ['tcp', 'mma2'].includes(key) && consumeActivity(status, name, key)) {
        const reducedMotion = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!reducedMotion && button.animate) button.animate([{filter: 'brightness(1)'}, {filter: 'brightness(1.9)'}, {filter: 'brightness(1)'}], {duration: 240, iterations: 1});
      }
    }
  };
  const api = {create, viewModel, update};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.mcsComms = api;
})(typeof window === 'undefined' ? globalThis : window);
