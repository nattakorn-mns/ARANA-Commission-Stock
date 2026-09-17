/* Approved presentation bridge for the real history data. No calculations or data sources are replaced. */
const summaryBridgeOriginalRender=renderHistory;
renderHistory=function(container){
  summaryBridgeOriginalRender(container);
  container.querySelector('#hist-kpi-dashboard')?.classList.add('summary-kpis');
  const cards=container.querySelectorAll('#hist-kpi-dashboard > .stat-card');
  const classes=['kpi-service','kpi-upsell','kpi-cross','kpi-product','kpi-total'];
  cards.forEach((card,i)=>{card.classList.add('summary-kpi',classes[i]||'');});
  const filter=container.querySelector('.filter-bar'); if(filter) filter.classList.add('summary-toolbar');
  const table=container.querySelector('#history-content'); if(table) table.classList.add('summary-table-wrap');
};