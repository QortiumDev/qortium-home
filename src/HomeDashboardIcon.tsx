import homeIconUrl from './assets/icons/qortium-home-protoicon-thick-interior.png';

export function HomeDashboardIcon() {
  return (
    <span className="dashboard-home-icon" aria-hidden="true">
      <img className="dashboard-home-icon__image" src={homeIconUrl} alt="" decoding="async" />
    </span>
  );
}
