import React from 'react';

interface Props {
  title: string;
  value: string | number;
  subtext?: string;
  color?: 'green' | 'red' | 'yellow' | 'blue';
}

const StatsCard: React.FC<Props> = ({ title, value, subtext, color = 'blue' }) => {
  const colorClasses = {
    green: 'bg-green-50 border-green-200 text-green-700',
    red: 'bg-red-50 border-red-200 text-red-700',
    yellow: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
  };

  return (
    <div className={`p-4 rounded-lg border shadow-sm ${colorClasses[color]}`}>
      <h3 className="text-sm font-medium uppercase tracking-wider opacity-80">{title}</h3>
      <p className="text-3xl font-bold mt-1">{value}</p>
      {subtext && <p className="text-sm mt-1 opacity-70">{subtext}</p>}
    </div>
  );
};

export default StatsCard;