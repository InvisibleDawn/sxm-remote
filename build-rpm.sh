#!/bin/bash
# Construit le paquet RPM : ./build-rpm.sh  → résultat dans ~/rpmbuild/RPMS/noarch/
set -e
cd "$(dirname "$0")"
mkdir -p ~/rpmbuild/{SOURCES,SPECS}
cp sxm-remote.py sxm-remote.desktop ~/rpmbuild/SOURCES/
rpmbuild -bb packaging/sxm-remote.spec
