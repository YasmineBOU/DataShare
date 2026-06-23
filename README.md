# DataShare

> Application de partage de fichiers sécurisé — upload anonyme ou connecté, liens temporaires protégeables par mot de passe.

[![Angular](https://img.shields.io/badge/Angular-21.2.17-DD0031?logo=angular)](https://angular.dev)
[![Spring Boot](https://img.shields.io/badge/Spring%20Boot-4.0.6-6DB33F?logo=springboot)](https://spring.io/projects/spring-boot)
[![Java](https://img.shields.io/badge/Java-25-orange?logo=openjdk)](https://openjdk.org)
[![License](https://img.shields.io/badge/license-private-lightgrey)]()

---

## Sommaire

- [Aperçu](#aperçu)
- [Fonctionnalités](#fonctionnalités)
- [Stack technique](#stack-technique)
- [Architecture](#architecture)
- [Prérequis](#prérequis)
- [Installation](#installation)
- [Configuration](#configuration)
- [Lancement](#lancement)
- [Tests](#tests)
- [Documentation](#documentation)
- [Structure du projet](#structure-du-projet)

---

## Aperçu

DataShare permet à n'importe quel visiteur de déposer un fichier (jusqu'à 1 Go) et d'obtenir un lien de partage temporaire. Les utilisateurs inscrits bénéficient en plus d'un espace personnel pour retrouver, gérer et supprimer leurs fichiers.

| | |
|---|---|
| **Upload** | Anonyme ou connecté, jusqu'à 1 Go, protection par mot de passe optionnelle |
| **Téléchargement** | Via lien unique, sans compte requis |
| **Expiration** | Automatique entre 1 et 7 jours |
| **Sécurité** | JWT (cookie HttpOnly), BCrypt, vérification d'intégrité BLAKE3, HTTPS |
| **Stockage** | Backblaze B2 (compatible S3), chiffrement côté serveur |

---

## Fonctionnalités

- Upload de fichier avec ou sans compte
- Protection d'un fichier par mot de passe
- Choix de la durée d'expiration (1 à 7 jours)
- Génération de lien de téléchargement unique et non prédictible
- Inscription / connexion / déconnexion
- Tableau de bord personnel : listing, filtres (tous / actifs / expirés), suppression
- Vérification d'intégrité des fichiers (hash BLAKE3 calculé client + serveur)
- Interface responsive (mobile / desktop)

---

## Stack technique

### Frontend

| Techno | Version |
|---|---|
| Angular | 21.2.17 |
| TypeScript | 5.9.x |
| Tailwind CSS | 4.2.x |
| hash-wasm (BLAKE3) | 4.12.x |

### Backend

| Techno | Version |
|---|---|
| Java (JDK) | 25 |
| Spring Boot | 4.0.6 |
| Spring Security | — |
| Spring Data JPA | — |
| PostgreSQL | — |

### Tests & Qualité

| Outil | Usage |
|---|---|
| JUnit 5 + Mockito | Tests unitaires et d'intégrations backend |
| JaCoCo | Couverture de code backend |
| Jest | Tests unitaires et couverture de code frontend |
| Cypress 15 | Tests end-to-end |
| k6 | Tests de performance |

### Infrastructure

- **Stockage fichiers** : Backblaze B2 (API compatible S3)
- **Communication** : HTTPS / TLS de bout en bout (front et back)

---

## Architecture

```
Navigateur (Angular SPA — CSR - port 4200)
        │  HTTPS + cookie HttpOnly (JWT)
        ▼
API REST Spring Boot (port 8443)
        │
        ├─> PostgreSQL        (utilisateurs, métadonnées fichiers)
        └─> Backblaze B2      (contenu binaire des fichiers)
```

---

## Prérequis

```bash
node --version    # >= 22.12.0
npm --version     # >= 10.9.0
java --version    # >= 25
mvn --version     # >= 3.9.x
Docker
Docker Compose 
```

Un compte [Backblaze B2](https://www.backblaze.com/b2/cloud-storage.html) avec un bucket et une clé d'application.

---

## Installation

### Cloner le dépôt

```bash
git clone <url-du-repo>
cd datashare
```

### Frontend

```bash
cd DataShare_Frontend
npm install
```

### Backend

```bash
cd DataShare_Backend
./mvnw install -DskipTests
```

---

## Configuration

Créer `DataShare_Backend/src/main/resources/application.yml`:

```properties
# Base de données
spring:
  datasource:
    username: <db_user>
    password: <db_password>
    url: jdbc:postgresql://<db_host>:<db_port>/<db_name>

# Backblaze B2
b2:
  endpoint: <endpoint>
  region: <region>
  bucket-name: <bucket_name>
  key-id: <key_id>
  application-key: <application_key>

# JWT
com:
  openclassrooms:
    datashare:
      jwt:
        secret-key: <secret_key>
        expiration-ms: 86400000

# SSL
server:
  port: 8443
  ssl:
    key-store: <path_vers_keystore>
    key-store-password: <password>
```

> **Important** — ce fichier contient des secrets et doit rester exclu de Git (`.gitignore`).

---

## Lancement

### Développement

```bash
# Terminal 1 — Backend
cd DataShare_Backend
./mvnw spring-boot:run
## Ou sur windows, se servir du script .bat
.\java25.bat run

# Terminal 2 — Frontend HTTPS
cd DataShare_Frontend
npm run start:https
```

- Frontend : `https://localhost:4200`
- Backend : `https://localhost:8443`

### Build production

```bash
# Frontend
npm run build
# → dist/DataShare_Frontend/browser/

# Backend
./mvnw package -DskipTests
java -jar target/datashare-backend-*.jar --spring.profiles.active=production
```

---

## Tests

```bash
# ── Frontend ──
npm test                          # Tests unitaires (Jest)
npx jest --coverage               # Avec rapport de couverture (Jest)

# Tests E2E
npm run start:e2e                 # Terminal 1
npm run cy:open                   # Terminal 2 — interface interactive Cypress
npm run cy:run                    # Mode headless (CI)

# ── Backend ──
./mvnw test                        # Tests unitaires + intégration
./mvnw test jacoco:report          # Avec rapport de couverture généré dans target/site/jacoco (JacoCo)

# ── Performance ──
## Tests en local
mkdir k6-results
### Créer un fichier secrets.json où seront stockés les identifiants d'un utilisateur test
### Créer un dossier data avec des fichiers variable en poids et formats de compression
k6 run performance-tests/datashare-load-tests.js

## Tests dans Graphana Cloud 
### Créer un script et y coller le contenu de 'performance-tests/cloud-datashare-load-tests.js'
### Adapter le script pour une pluralité de fichiers et de localisations users
```

Détails complets : [`TESTING.md`](./quality-assurance/TESTING.md)

---

## Documentation

| Fichier | Contenu |
|---|---|
| [`TESTING.md`](./quality-assurance/TESTING.md) | Plan de tests, couverture de code |
| [`SECURITY.md`](./quality-assurance/SECURITY.md) | Mesures de sécurité, authentification, chiffrement |
| [`PERFORMANCES.md`](./quality-assurance/PERFORMANCES.md) | Résultats des tests de charge k6 |
| [`MAINTENANCE.md`](./quality-assurance/MAINTENANCE.md) | Procédures de mise à jour et maintenance |
| [`openapi.yaml`](./backend/src/main/resources/static/api-docs/openapi.yaml) | Spécification OpenAPI de l'API REST |
| [`index.html`](./backend/src/main/resources/static/openapi.html) | Documentation API interactive (Swagger UI) |

---

## Structure du projet

```
datashare/
├── DataShare_Frontend/
│   ├── src/app/
│   │   ├── core/              ← services, modèles, config, utils
│   │   ├── layouts/           ← PublicLayout
│   │   ├── pages/             ← login, register, file-upload, file-download,
│   │   │                         file-listing, dashboard, dashboard-sidebar, header
│   │   └── shared/            ← composants réutilisables
│   ├── cypress/               ← tests E2E + mocks
│   └── package.json
│
├── DataShare_Backend/
│   ├── src/main/java/com/openclassrooms/datashare/
│   │   ├── configuration/security/   ← Spring Security, JWT, CORS
│   │   ├── controller/               ← endpoints REST
│   │   ├── dto/                      ← Data Transfer Objects
│   │   └── entities/                 ← entités
│   │   └── handler/                  ← Gestionnaire d'exception
│   │   └── mapper/                   ← Mapper dto ↔ entité 
│   │   ├── repository/               ← Spring Data JPA
│   │   ├── scheduler/                ← Plannificateur de tâches (cronjob)
│   │   ├── service/                  ← logique métier
│   │   ├── utils/                    ← Utilitaires divers
│   ├── src/test/                     ← tests unitaires + intégrations
│   └── pom.xml
│
├── performance-tests/
│   └── datashare-load-tests.js          ← scénarios k6 en local
│   └── cloud-datashare-load-tests.js    ← scénarios k6 dans un cloud
│
├── api-docs/
│   ├── openapi.yaml
│   └── index.html
│
├── quality-assurance/
│   └── MAINTENANCE.md          ← Procédure de mises à jour et de maintenance 
│   └── PERF.md                 ← Tests de performances et procédure 
│   └── SECURITY.md             ← Résultat de scan de sécurité, ...
│   └── TESTING.md              ← Plan de tests et résultats 
```