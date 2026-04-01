# Sakaii Status

Page de statut publique et panel admin pour monitorer les services self-hosted du projet Sakaii.

## Fonctionnalites

- Page publique sur `/`
- Panel admin protege par mot de passe sur `/admin`
- 4 statuts disponibles :
  - `En ligne`
  - `Mise a jour`
  - `Migration`
  - `Hors ligne`
- Stockage local dans `data.json`
- Initialisation automatique du fichier de donnees au premier lancement
- Gestion des incidents avec creation, edition et suppression
- Heure de fin optionnelle sur les incidents
- Mise a jour directe du statut des services depuis l'admin
- Ajout et suppression de services depuis l'admin
- Monitoring automatique des URLs pour basculer entre `En ligne` et `Hors ligne`
- Changement du mot de passe admin depuis l'interface
- Journal des evenements securite / systeme dans l'admin
- Verrouillage du login apres 3 tentatives par IP par defaut
- Design responsive, leger et facile a deployer dans un LXC

## Structure

```text
sakaii-status/
├── server.js
├── data.default.json
├── data.json
├── public/
│   ├── index.html
│   ├── admin.html
│   ├── index.js
│   ├── admin.js
│   └── styles.css
├── package.json
├── .env.example
└── README.md
```

## Prerequis

- Node.js 18+ recommande

## Installation

```bash
npm install
```

## Configuration

Copier `.env.example` en `.env` puis definir vos valeurs :

```env
ADMIN_PASSWORD=sakaii
PORT=3000
MONITOR_INTERVAL_MS=60000
LOGIN_MAX_ATTEMPTS=3
LOGIN_LOCKOUT_MS=900000
MAX_EVENT_LOGS=150
```

Notes :

- `ADMIN_PASSWORD` sert de mot de passe de depart
- par defaut, le premier mot de passe est `sakaii`
- une fois modifie depuis l'admin, le hash est stocke dans `data.json`
- `PORT` est optionnel, defaut `3000`
- `MONITOR_INTERVAL_MS` controle la frequence de ping des services
- `LOGIN_MAX_ATTEMPTS` definit le nombre max d'essais de connexion avant blocage
- `LOGIN_LOCKOUT_MS` definit la duree du blocage apres trop d'echecs
- `MAX_EVENT_LOGS` limite la taille du journal d'evenements

## Lancement

```bash
npm start
```

L'application sera accessible sur :

- Page publique : `http://localhost:3000/`
- Admin : `http://localhost:3000/admin`

## Fonctionnement des donnees

- `data.json` contient la liste des services et l'historique des incidents
- `data.default.json` sert de modele versionnable pour initialiser les donnees
- `data.json` est ignore par git pour eviter d'exposer incidents, journaux et hash admin
- si `data.json` n'existe pas ou est invalide, il est regenere automatiquement
- les incidents sont tries du plus recent au plus ancien
- la page publique affiche uniquement les 8 incidents les plus recents
- la suppression d'un incident recalcule automatiquement le statut du service concerne
- le monitoring automatique met a jour les services en `online` ou `offline`
- les statuts `update` et `migration` restent manuels et ne sont pas ecrases par le monitoring

## Deploiement LXC / Proxmox

Exemple simple :

1. Installer Node.js dans le conteneur
2. Copier le projet dans le LXC
3. Creer un fichier `.env`
4. Lancer `npm install`
5. Lancer `npm start`
6. Exposer l'app via votre Cloudflare Tunnel vers `http://127.0.0.1:3000`

Pour un usage plus propre en continu, vous pouvez l'executer avec `systemd`, `pm2` ou un conteneur Docker leger.

## Securite

- L'auth admin repose sur un mot de passe unique fourni par `ADMIN_PASSWORD`
- un cookie HTTP-only est pose apres connexion
- les tentatives de connexion sont limitees par IP
- les acces admin invalides, echecs de login, verrouillages, changements de mot de passe et erreurs systeme sont traces
- des headers de securite HTTP sont envoyes par le serveur
- ce projet est pense pour un homelab et une exposition derriere Cloudflare Tunnel

## Licence

Ce projet est publie en depot public mais reste proprietaire.

- consultation du code autorisee
- reutilisation, modification, deployment ou redistribution interdits sans autorisation prealable
- voir le fichier `LICENSE`

## Services initialises par defaut

- `sakaii.org`
- `cloud.sakaii.org`
- `stream.sakaii.org`
- `pdf.sakaii.org`
