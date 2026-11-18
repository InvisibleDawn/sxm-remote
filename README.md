# SXM Remote

Client Bureau à distance (RDP) simple pour Fedora, dans le style de Windows App.
Basé sur FreeRDP, interface GTK3.

## Fonctions
- Tes PC en cartes, connexion en un clic (IP locale ou Tailscale)
- Connexion rapide par IP et liste des appareils Tailscale
- Mots de passe stockés dans le trousseau du système
- Plein écran, multi-écran, presse-papiers, son, partage de dossier
- Mise à jour intégrée depuis les Releases GitHub

## Installation
Télécharge le `.rpm` de la dernière [Release](../../releases/latest), puis :

```
sudo dnf install ./sxm-remote-*.noarch.rpm
```

Raccourci utile : **Ctrl + Alt + Entrée** pour quitter / revenir au plein écran.

## Construire le paquet
```
./build-rpm.sh
```
