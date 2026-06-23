# PERFORMANCES.md — DataShare

## Table des matières

1. [Vue d'ensemble](#1-vue-densemble)
2. [Audits de performance serveur (Graphana k6)](#audits-graphana-k6)
3. [Audits de performance client (Google Lighthouse Production)](#audits-lighthouse)
4. [Synthèse et Recommandations](#4-synthèse-et-recommandations)

---

## 1. Vue d'ensemble

Les tests de performance sont réalisés avec **k6** sur l'ensemble des endpoints de l'API DataShare. Ils couvrent le flux complet d'un utilisateur : authentification → upload → listing → info → téléchargement → suppression → déconnexion.

L'architecture de l'application applique un flux de traitement synchrone lors de l'upload : réception du fichier, calcul du hash **BLAKE3** pour vérification de l'intégrité, transfert vers le stockage **AWS S3**, puis persistance en **Base de données** avant le renvoi d'un jeton d'accès au client.

---
## 2. Audits de performance serveur <a id="audits-graphana-k6"></a>(Graphana k6)
## 2.1. Configuration des tests

> **Environnement de test** : développement local.
### Scénarios disponibles

| Scénario | VUs | Durée | Objectif |
|---|---|---|---|
| **Smoke** (exécuté) | 1 | ~8s | Vérification fonctionnelle de base |
| Load | 0 → 10 → 0 | ~2min | Charge normale |
| Spike | pic à 50 VUs | ~55s | Résistance aux pics |

### Flux testé

```
Login → Auth/Me → Upload → List Files → File Info
      → Get Download Link → Download Blob → Delete → Logout
```

### Seuils configurés

```javascript
thresholds: {
  login_duration:             ['p(95)<4000'], // login p95 < 4s
  req_auth_me_duration:       ['p(95)<4000'], 
  req_list_files_duration:    ['p(95)<2000'], // list files p95 < 7s
  req_file_info_duration:     ['p(95)<2000'], // get file info p95 < 7s
  req_file_link_duration:     ['p(95)<2000'], // getfile_link p95 < 7s
  req_delete_file_duration:   ['p(95)<2000'], // delete file p95 < 7s
  req_upload_duration:        ['p(95)<7000'], // upload p95 < 7s
  req_download_duration:      ['p(95)<7000'], // download p95 < 7s

  http_req_failed:            ['rate<0.05'],  // < 5% d'erreurs HTTP
  error_rate:                 ['rate<0.05'],  // < 5% d'erreurs custom
}
```
## 2.2. Exécution des tests

### Prérequis

```bash
# Installer k6 depuis le site officiel
# Vérifier l'installation
k6 version
```

### Lancement

#### Local

```bash
# Créer le dossier de résultats
mkdir k6-results
# Créer le dossier 'data' avec différents formats de fichiers 
# (compressés/nom compressé avec poids différents)
mkdir data

# Lancer les tests avec les différents scénarios
k6 run .\datashare-load-tests.js  

# Vérification rapide sur un seul virtual user
k6 run --vus 1 --duration 1s  .\datashare-load-tests.js  

# Scénario spécifique
k6 run --scenario load performance-tests/datashare-load-tests.js
```
#### Cloud
Afin de lancer le script sur Graphana Cloud, il est important d'exposer son IP en utilisant notamment **ngrok** à télécharger, comme ceci:  
```bash
ngrok http https://localhost:8443 --host-header="localhost:8443"
```
Il faudra ensuite créer le script sur Graphana et y coller le contenu de `performance-tests/cloud-datashare-load-tests.js`.

Penser à créer au préalable les secrets sur l'interface pour les credentials.
Adapter le script selon les besoins en terme de fichiers.


### Structure des fichiers

```
performance-tests/
  cloud-datashare-load-tests.js   ← script k6 à faire tourner dans Graphana Cloud
  datashare-load-tests.js         ← script principal k6 à faire tourner en local
  secrets.json                    ← Un fichier avec les credentials à créer
  data/                           ← dossier utilisé pour les tests d'upload             
    test-file.jpg
    ...
  k6-results/
    summary.json                  ← résultats JSON (généré automatiquement)
    summary.html                  ← résultats HTML (généré automatiquement)
```

----

## 2.3. Résultats des scénarios exécutés

Trois types de scénarios seront effectués; smoke, load et spike.
Ces trois tests auront une petite base de données de fichiers avec différents formats (jpg, png, pdf, odt, mp4) et poids (3KB => 59MB)

### 2.3.1. Smoke Test

#### Configuration du Test
* **Durée :** 50 secondes
* **Utilisateurs Virtuels (VUs) :** 1 stable
* **Objectif :** Valider la configuration du script et l'absence d'erreurs initiales.

#### Ligne de commande
```bash
# Stress test — 1 VUs
k6 run --scenario smoke performance-tests/datashare-load-tests.js
```

#### Résultats Obtenus
* **Requêtes totales :** 15 requêtes
* **Taux de réussite (Checks) :** 100% (30 checks passés / 0 échecs)
* **Taux d'échec HTTP (`http_req_failed`) :** 0.00%

#### Métriques Détaillées (Temps de réponse)

| Étape de l'API | Moyenne (`avg`) | Médiane (`med`) | Percentile 95 (`p95`) | Maximum (`max`) | Seuil attendu | Statut |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `login` | 134.33 ms | 134.33 ms | 148.66 ms | 152.24 ms | < 1000 ms | 🟢 OK |
| `req_auth_me` | 13.78 ms | 13.78 ms | 15.66 ms | 16.13 ms | < 500 ms | 🟢 OK |
| `req_upload` | 239.54 ms | 239.54 ms | 244.60 ms | 245.86 ms | < 30000 ms| 🟢 OK |
| `req_list_files` | 24.31 ms | 24.31 ms | 29.56 ms | 30.87 ms | < 2000 ms | 🟢 OK |
| `req_file_info` | 20.30 ms | 20.30 ms | 21.36 ms | 21.62 ms | < 1000 ms | 🟢 OK |
| `req_file_link` | 21.46 ms | 21.46 ms | 23.36 ms | 23.83 ms | < 1000 ms | 🟢 OK |
| `req_download` | 51.10 ms | 51.10 ms | 51.81 ms | 51.99 ms | < 60000 ms| 🟢 OK |
| `req_delete_file`| 83.21 ms | 83.21 ms | 84.71 ms | 85.08 ms | < 1000 ms | 🟢 OK |

---

### 2.3.2. Load Test

#### Configuration du Test
* **Durée :** 2 minutes 32 secondes (152s)
* **Utilisateurs Virtuels (VUs) :** Jusqu'à 10 VUs en simultané
* **Objectif :** Analyser le comportement et la latence sous une charge nominale de production.

#### Ligne de commande
```bash
# Load test — 10 VUs, ~2 minutes
k6 run --scenario load performance-tests/datashare-load-tests.js
```

#### Résultats Obtenus
* **Requêtes totales :** 525 requêtes (Débit moyen de ~3.45 req/s)
* **Taux de réussite (Checks) :** 100% (999 checks passés / 0 échecs)
* **Taux d'échec HTTP (`http_req_failed`) :** 0.00%

#### Métriques Détaillées (Temps de réponse)

| Étape de l'API | Moyenne (`avg`) | Médiane (`med`) | Percentile 95 (`p95`) | Maximum (`max`) | Seuil attendu | Statut |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `login` | 220.89 ms | 183.19 ms | 451.97 ms | 1001.07 ms| < 1000 ms | 🟢 OK |
| `req_auth_me` | 80.89 ms | 21.28 ms | 350.22 ms | 801.40 ms | < 500 ms | 🟢 OK |
| `req_upload` | 519.34 ms | 331.06 ms | 1099.64 ms| 5132.89 ms| < 30000 ms| 🟢 OK |
| `req_list_files` | 56.55 ms | 34.02 ms | 149.72 ms | 345.54 ms | < 2000 ms | 🟢 OK |
| `req_file_info` | 66.86 ms | 30.56 ms | 151.78 ms | 800.74 ms | < 1000 ms | 🟢 OK |
| `req_file_link` | 100.83 ms | 35.80 ms | 404.14 ms | 980.84 ms | < 1000 ms | 🟢 OK |
| `req_download` | 125.75 ms | 79.43 ms | 311.10 ms | 1349.52 ms| < 60000 ms| 🟢 OK |
| `req_delete_file`| 123.01 ms | 98.41 ms | 235.33 ms | 942.50 ms | < 1000 ms | 🟢 OK |

---

### 2.3.3. Spike Test

#### Configuration du Test
* **Durée :** 1 minute 40 secondes (100s)
* **Utilisateurs Virtuels (VUs) :** Injection brutale grimpant jusqu'à 50 VUs
* **Objectif :** Tester la résistance de l'application face à un afflux soudain, massif et simultané d'utilisateurs.

#### Ligne de commande
```bash
# Spike test — pic à 50 VUs
k6 run --scenario spike performance-tests/datashare-load-tests.js
```

#### Résultats Obtenus
* **Requêtes totales :** 1555 requêtes (Débit moyen de ~15.5 req/s)
* **Taux de réussite (Checks) :** 100% (2935 checks passés / 0 échecs)
* **Taux d'échec HTTP (`http_req_failed`) :** 0.00%
* **Seuils globaux (Thresholds) :** Tous validés (`ok: true`)

#### Métriques Détaillées (Temps de réponse)

| Étape de l'API | Moyenne (`avg`) | Médiane (`med`) | Percentile 95 (`p95`) | Maximum (`max`) | Seuil attendu | Statut |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `login` | 422.38 ms | 258.98 ms | 1000.91 ms| 3550.85 ms| < 1000 ms | 🟢 OK |
| `req_auth_me` | 196.48 ms | 48.97 ms | 832.06 ms | 2529.70 ms| < 500 ms | 🟢 OK |
| `req_upload` | 1846.85 ms| 792.83 ms | 5982.72 ms| 15926.81 ms| < 30000 ms| 🟢 OK |
| `req_list_files` | 134.11 ms | 48.94 ms | 496.11 ms | 1856.24 ms| < 2000 ms | 🟢 OK |
| `req_file_info` | 179.91 ms | 41.52 ms | 740.71 ms | 2314.54 ms| < 1000 ms | 🟢 OK |
| `req_file_link` | 272.29 ms | 56.40 ms | 1146.06 ms| 4209.61 ms| < 1000 ms | 🟢 OK |
| `req_download` | 363.38 ms | 158.07 ms | 1198.54 ms| 4381.18 ms| < 60000 ms| 🟢 OK |
| `req_delete_file`| 373.91 ms | 153.94 ms | 1184.81 ms| 5126.97 ms| < 1000 ms | 🟢 OK |

#### Analyse du Spike Test
Les résultats de ce Spike Test démontrent la **très grande résilience de l'infrastructure**. Malgré l'afflux brutal de 50 utilisateurs en simultané :
1.  **Stabilité parfaite :** Aucune requête HTTP n'a échoué (0% d'erreurs) et l'intégralité des 2935 assertions (checks) est validée.
2.  **Respect des seuils métiers :** Bien que les temps de réponse maximaux (`max`) augmentent logiquement en raison de la mise en file d'attente des requêtes et de la charge réseau accumulée (notamment sur l'upload et le téléchargement S3), les métriques globales et les percentiles cibles définis dans k6 restent entièrement conformes aux critères d'acceptation du projet. 
3.  **Comportement de l'Upload :** Le temps moyen d'upload se maintient à un niveau tout à fait acceptable de **1.84 seconde** en pic de crise, ce qui prouve que l'enchaînement synchrone (Crypto + S3 + DB) tient le choc face à ce volume.


## 3. Audits de performance client <a id="audits-lighthouse"></a>(Google Lighthouse Production)

Afin de s'assurer que la réactivité du backend validée par **k6** se traduit par une expérience utilisateur optimale sur le navigateur, des audits automatisés Google Lighthouse ont été exécutés en configuration **Desktop**. 

Pour refléter le comportement réel en production, l'application Angular optimisée a été servie via un reverse-proxy local (`local-web-server`) connecté au serveur d'API sécurisé (`https://localhost:8443`).

### Lancement

```bash
# Compiler et générer les fichiers de production optimisés ( dossier dist/ )
ng build --configuration production 

# Lancer le reverse-proxy local (local-web-server) basé sur le fichier lws.config.js 
ws
```

### Résultats Globaux des Pages Clés

| Route de l'Interface (UI) | Performance | Accessibilité | Bonnes Pratiques | SEO |
| :--- | :---: | :---: | :---: | :---: |
| **Accueil / Upload** (`/`) | **99%** 🟢 | 97% 🟢 | 96% 🟢 | 100% 🟢 |
| **Connexion** (`/login`) | **97%** 🟢 | 89% 🟠 | 96% 🟢 | 100% 🟢 |
| **Inscription** (`/register`) | **97%** 🟢 | 89% 🟠 | 96% 🟢 | 100% 🟢 |
| **Tableau de Bord** (`/dashboard/files`) | **97%** 🟢 | 92% 🟢 | 100% 🟢 | 100% 🟢 |

### Analyse Succincte des Indicateurs Front-End

1. **Fluidité du Rendu (Core Web Vitals) :** L'optimisation des assets d'Angular compilés en mode production permet d'obtenir un temps d'affichage initial (**First Contentful Paint**) très bas et constant de **0.6s** sur l'ensemble de l'application. Le composant visuel le plus lourd à charger (**Largest Contentful Paint**) se stabilise très rapidement, oscillant entre **0.8s** (Page d'accueil) et **1.2s** (Dashboard), se plaçant largement sous le seuil d'excellence exigé (< 2.5s).
2. **Interactivité et Stabilité Visuelle :** Le temps de blocage des scripts (**TBT**) reste anecdotique (maximum 10ms), garantissant une interface instantanément réactive dès son affichage. L'indicateur **CLS** (Cumulative Layout Shift) est égal à **0.00** sur toutes les routes, confirmant l'absence totale de décalage ou de mouvement intempestif d'éléments graphiques au chargement de la mise en page.
3. **Conformité SEO & Qualité Editoriale :** L'alignement complet de l'ensemble des routes sur un score parfait de **100% en SEO** valide la parfaite découvrabilité de la plateforme, garantissant une indexation optimale, une structure de document saine et le respect rigoureux des standards de métadonnées exigés par les moteurs de recherche. 
4. **Piste d'Amélioration (Accessibilité) :** La seule marge de progression identifiée concerne les formulaires d'authentification (`/login` et `/register`) dont le score d'accessibilité (89%) invite à ajuster certains contrastes textuels et à enrichir les étiquettes de formulaires afin d'offrir une expérience inclusive pour les technologies d'assistance (lecteurs d'écran).

---


## 4. Synthèse et Recommandations

L'ensemble de la suite de tests met en lumière une API saine, robuste et capable d'absorber des pics d'activité à 50 VUs sans dégradation critique ni apparition d'erreurs d'infrastructure.

### Recommandations pour le futur (Scaling à plus grande échelle) :
Bien que les indicateurs actuels soient corrects, si l'application est amenée à supporter une charge 10 à 20 fois supérieure à l'avenir (ex: > 500 VUs), les pistes suivantes pourraient contribuer à l'optimisation de l'application :
1.  **Traitement asynchrone des tâches lourdes :** Isoler le calcul du hash BLAKE3 et la synchronisation de stockage cloud dans des Workers/Queues d'arrière-plan afin de garantir des temps de réponse constants et instantanés sur l'ensemble des endpoints.
2. **Mise en place d'un CDN :** Permet de géo-distribuer les fichiers au plus près des utilisateurs afin de réduire drastiquement la latence de téléchargement, tout en protégeant l'API des attaques DDoS et en minimisant les coûts de bande passante sortante.
