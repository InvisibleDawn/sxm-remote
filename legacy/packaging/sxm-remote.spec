Name:           sxm-remote
Version:        1.3
Release:        1%{?dist}
Summary:        Client Bureau à distance (RDP) simple, style Windows App
License:        MIT
BuildArch:      noarch
Source0:        sxm-remote.py
Source1:        sxm-remote.desktop
Requires:       python3 python3-gobject gtk3 freerdp libsecret polkit
Recommends:     gnome-keyring

%description
Client RDP simple pour se connecter à ses PC Windows par IP ou Tailscale.

%install
install -Dm755 %{SOURCE0} %{buildroot}%{_bindir}/sxm-remote
install -Dm644 %{SOURCE1} %{buildroot}%{_datadir}/applications/sxm-remote.desktop

%files
%{_bindir}/sxm-remote
%{_datadir}/applications/sxm-remote.desktop
