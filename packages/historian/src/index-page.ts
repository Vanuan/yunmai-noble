export const INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>yunmai-noble historian</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 42rem; margin: 3rem auto; padding: 0 1rem; color: #1f2933; }
    h1 { margin-bottom: .25rem; }
    .muted { color: #616e7c; }
    #latest { font-size: 2rem; }
    ul { padding-left: 1.25rem; }
    li { margin: .25rem 0; }
    a { color: #2563eb; }
  </style>
</head>
<body>
  <h1>yunmai-noble</h1>
  <p class="muted">Historian status: <span id="status">loading...</span></p>
  <p>Latest: <strong id="latest">&mdash;</strong></p>
  <ul id="readings"></ul>
  <p class="muted"><a href="/api/measurements">API</a> &middot; <a href="/health">Health</a></p>

  <script>
    var statusEl = document.getElementById('status');
    var latestEl = document.getElementById('latest');
    var listEl = document.getElementById('readings');

    function showLatest(weightKg) {
      latestEl.textContent = weightKg.toFixed(2) + ' kg';
    }

    function addReading(label, weight) {
      var item = document.createElement('li');
      item.textContent = label + ': ' + (weight / 100).toFixed(2) + ' kg';
      listEl.insertBefore(item, listEl.firstChild);
    }

    function refresh() {
      fetch('/health')
        .then(function(response) { return response.json(); })
        .then(function(health) { statusEl.textContent = health.status; })
        .catch(function() { statusEl.textContent = 'offline'; });

      fetch('/api/measurements/latest')
        .then(function(response) { return response.ok ? response.json() : null; })
        .then(function(measurement) {
          if (measurement) showLatest(measurement.weightKg);
        })
        .catch(function() {});
    }

    refresh();

    var events = new EventSource('/api/events');
    events.onopen = function() { statusEl.textContent = 'live'; };
    events.onerror = function() { statusEl.textContent = 'reconnecting'; };
    events.onmessage = function(event) {
      var message = JSON.parse(event.data);
      if (message.type !== 'measurement.completed') return;
      showLatest(message.payload.weight / 100);
      addReading(new Date(message.payload.measuredAt).toLocaleString(), message.payload.weight);
    };
  </script>
</body>
</html>`;
