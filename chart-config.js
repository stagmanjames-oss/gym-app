// chart-config.js — Chart.js PR graph wrapper

function renderPRGraph(canvasId, data, isBodyweight) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  // Destroy any existing chart on this canvas
  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();

  if (!data || data.length === 0) {
    const ctx2d = canvas.getContext('2d');
    ctx2d.fillStyle = '#8E97A6';
    ctx2d.font = '14px Inter, sans-serif';
    ctx2d.textAlign = 'center';
    ctx2d.fillText('No data yet', canvas.width / 2, canvas.height / 2);
    return;
  }

  const labels = data.map(d => {
    const date = new Date(d.date + 'T00:00:00');
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  });
  const values = data.map(d => d.value);
  const allTimePR = Math.max(...values);

  const ctx = canvas.getContext('2d');

  new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: values,
        borderColor: '#C9A84C',
        backgroundColor: 'rgba(201, 168, 76, 0.08)',
        pointBackgroundColor: '#C9A84C',
        pointBorderColor: '#C9A84C',
        pointRadius: 5,
        pointHoverRadius: 7,
        borderWidth: 2,
        tension: 0.3,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      animation: { duration: 400, easing: 'easeOutQuart' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1C2230',
          borderColor: '#1E2D40',
          borderWidth: 1,
          titleColor: '#F0EBE1',
          bodyColor: '#C9A84C',
          titleFont: { family: 'Inter', size: 12 },
          bodyFont: { family: 'JetBrains Mono', size: 13 },
          callbacks: {
            label: ctx => {
              const v = ctx.parsed.y;
              return isBodyweight ? `${v} reps` : `${v} kg`;
            },
          },
        },
        annotation: {
          annotations: {
            prLine: {
              type: 'line',
              yMin: allTimePR,
              yMax: allTimePR,
              borderColor: 'rgba(201, 168, 76, 0.3)',
              borderWidth: 1,
              borderDash: [6, 4],
              label: {
                display: true,
                content: 'All-time PR',
                color: '#8A6F32',
                font: { family: 'Inter', size: 10 },
                position: 'end',
              },
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: {
            color: '#8E97A6',
            font: { family: 'Inter', size: 11 },
            maxTicksLimit: 6,
          },
        },
        y: {
          grid: {
            color: 'rgba(30, 45, 64, 0.0)',
            drawBorder: false,
          },
          border: { display: false },
          ticks: {
            color: '#8E97A6',
            font: { family: 'JetBrains Mono', size: 11 },
            callback: v => isBodyweight ? `${v}` : `${v}kg`,
          },
        },
      },
    },
  });
}
