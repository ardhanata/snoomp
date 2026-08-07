import React from 'react';

interface RadialGaugeProps {
  value: number;
  label: string;
  sublabel?: string;
  max?: number;
  inverseColor?: boolean;
}

const RadialGauge: React.FC<RadialGaugeProps> = ({ value, label, sublabel, max = 100, inverseColor = false }) => {
  const percentage = Math.min(max, Math.max(0, value));

  // 100px container, radius=40 to match new CSS (.radial-container is 100px)
  const radius = 40;
  const circumference = 2 * Math.PI * radius; // ~251.2

  const strokeDashoffset = circumference - (percentage / max) * circumference;

  let statusClass = 'good';
  let cardClass = 'status-good';
  
  if (inverseColor) {
    if (percentage < 75) {
      statusClass = 'critical';
      cardClass = 'status-critical';
    } else if (percentage < 90) {
      statusClass = 'warning';
      cardClass = 'status-warning';
    }
  } else {
    if (percentage >= 90) {
      statusClass = 'critical';
      cardClass = 'status-critical';
    } else if (percentage >= 75) {
      statusClass = 'warning';
      cardClass = 'status-warning';
    }
  }

  return (
    <div className={`metric-card ${cardClass}`}>
      <span className="metric-label">{label}</span>
      <div className="radial-container">
        <svg className="radial-svg" viewBox="0 0 100 100">
          <circle
            className="radial-bg"
            cx="50"
            cy="50"
            r={radius}
            strokeWidth={9}
          />
          <circle
            className={`radial-progress ${statusClass}`}
            cx="50"
            cy="50"
            r={radius}
            strokeWidth={9}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
          />
        </svg>
        <div className="radial-value">{percentage.toFixed(0)}%</div>
      </div>
      {sublabel && <div className="radial-sub">{sublabel}</div>}
    </div>
  );
};

export default RadialGauge;
