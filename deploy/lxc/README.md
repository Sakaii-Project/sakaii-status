# Deployment LXC Proxmox

Ce dossier contient une methode simple pour deployer Sakaii Status dans un conteneur LXC Debian ou Ubuntu avec `systemd`.

## Hypothese recommandee

- LXC Debian 12 ou Ubuntu 24.04
- 1 vCPU minimum
- 512 Mo RAM minimum
- exposition via Cloudflare Tunnel vers `http://127.0.0.1:3000`

## Deploiement rapide

1. Copier le projet ou cloner le repo dans le LXC
2. Executer en root :

```bash
chmod +x deploy/lxc/install-lxc.sh
./deploy/lxc/install-lxc.sh
```

3. Editer le fichier :

```bash
nano /opt/sakaii-status/app/.env
```

4. Redemarrer le service :

```bash
systemctl restart sakaii-status
```

## Commandes utiles

```bash
systemctl status sakaii-status
journalctl -u sakaii-status -f
systemctl restart sakaii-status
```

## Mise a jour

```bash
cd /opt/sakaii-status/app
sudo -u sakaii git pull --ff-only
sudo -u sakaii npm ci --omit=dev
systemctl restart sakaii-status
```
