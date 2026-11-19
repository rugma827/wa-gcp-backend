import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';

const PieChart = ({ config }) => {
  const options = {
    chart: { type: 'pie', height: 350, ...(config?.chart || {}) },
    credits: { enabled: false },
    exporting: { enabled: false },
    ...config,
  };

  return <HighchartsReact highcharts={Highcharts} options={options} />;
};

export default PieChart;
