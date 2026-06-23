# MAINTENANCE.md — DataShare

## Table des matières

1. [Vue d'ensemble](#1-vue-densemble)
2. [Stack technique](#2-stack-technique)
3. [Prérequis et installation](#3-prérequis-et-installation)
4. [Structure du projet](#4-structure-du-projet)
5. [Lancement de l'application](#5-lancement-de-lapplication)
6. [Tests](#6-tests)
7. [Build et déploiement](#7-build-et-déploiement)
8. [Gestion des dépendances](#8-gestion-des-dépendances)
9. [Procédures de maintenance courantes](#10-procédures-de-maintenance-courantes)
10. [Surveillance et logs](#11-surveillance-et-logs)

---

## 1. Vue d'ensemble

L'application est composée de deux modules indépendants :

- **Frontend** : Angular 21 (TypeScript, Tailwind CSS)
- **Backend** : Spring Boot 4 (Java 25, REST API)

Les deux modules communiquent via une API REST sécurisée en HTTPS. Les fichiers sont stockés sur Backblaze B2 (compatible S3).

---

## 2. Stack technique

### Frontend

| Technologie | Version | Rôle |
|---|---|---|
| Angular | 21.2.17 | Framework UI |
| TypeScript | ~5.9.2 | Langage |
| Tailwind CSS | ^4.2.4 | Styles |
| hash-wasm | ^4.12.0 | Calcul du hash BLAKE3 |
| Node.js | 22.12.0 | Runtime |
| npm | 10.9.0 | Gestionnaire de paquets |

### Backend

| Technologie | Version | Rôle |
|---|---|---|
| Java (JDK) | 25 | Langage |
| Spring Boot | 4.0.6 | Framework |
| Spring Security | (Spring Boot 4) | Authentification JWT |
| Spring Data JPA | (Spring Boot 4) | Accès base de données |
| Maven | 3.9.x | Gestionnaire de dépendances |

### Outils de test

| Outil | Version | Usage |
|---|---|---|
| Jest | ^30.4.2 | Tests unitaires frontend |
| Cypress | ^15.16.0 | Tests E2E |
| k6 | latest | Tests de performance |
| JUnit 5 | (Spring Boot 4) | Tests unitaires backend |
| JaCoCo | (Spring Boot 4) | Couverture de code backend |

### Infrastructure

| Service | Usage |
|---|---|
| Backblaze B2 | Stockage des fichiers (compatible S3) |
| HTTPS / TLS | Chiffrement des communications |

---

## 3. Prérequis et installation

### Prérequis système

```bash
# Vérifier les versions installées
node --version    # >= 22.12.0
npm --version     # >= 10.9.0
java --version    # >= 25
mvn --version     # >= 3.9.x
```

### Installation du frontend

```bash
# Cloner le dépôt
git clone <url-du-repo>
cd DataShare_Frontend

# Installer les dépendances
npm install

# Générer le certificat SSL pour le développement local
node ./scripts/start-https.mjs
```

### Installation du backend

```bash
cd DataShare_Backend

# Installer les dépendances Maven
./mvnw install -DskipTests

# Configurer les variables d'environnement (voir section ci-dessous)
```

### Variables d'environnement backend

Les propriétés suivantes doivent être configurées dans `application.yml` ou via des variables d'environnement :

```properties
# Base de données
spring:
  datasource:
  url: jdbc:postgresql://<db_host>:<db_port>/<db_name>
  username: <db_user>
  password: <db_password>

# Backblaze B2
b2:
  endpoint: <endpoint_url> 
  region: <region>
  key-id: <key_id>
  application-key: <key>
  bucket-name: <bucket>

# JWT
jwt:
  secret-key: <secret_key>
  expiration-ms: 3600

# SSL (backend)
server:
  ssl:
    key-store: <path>
    key-store-password: <password>
    port:8443
```

> **Important** : Ne jamais committer `application.yml` contenant des secrets. Ce fichier est exclu via `.gitignore`.

---

## 4. Structure du projet

### Frontend

```
DataShare_Frontend/
├── src/
│   ├── app/
│   │   ├── core/
│   │   │   ├── config/          ← constantes (FILE_CONFIG, REGISTER_CONFIG, ...)
│   │   │   ├── guards/          ← Route guards
│   │   │   ├── models/          ← interfaces TypeScript
│   │   │   ├── service/         ← services Angular (auth, user, file, loading)
│   │   │   └── utils/           ← utilitaires (formatFileSize, computeChecksum)
│   │   ├── layouts/             ← PublicLayout
│   │   ├── pages/               ← composants de pages
│   │   │   ├── login/
│   │   │   ├── register/
│   │   │   ├── file-upload/
│   │   │   ├── file-download/
│   │   │   ├── file-listing/
│   │   │   ├── dashboard/
│   │   │   ├── dashboard-sidebar/
│   │   │   └── header/
│   │   └── shared/              ← composants réutilisables (LoadingSpinner)
│   ├── assets/                  ← icônes, images
│   └── styles.scss              ← styles globaux
├── cypress/
│   ├── e2e/                     ← tests Cypress
│   ├── fixtures/                ← données de test
│   └── support/                 ← commandes et mock backend
├── scripts/                     ← scripts utilitaires (SSL, UML)
├── angular.json
├── package.json
└── tsconfig.json
```

### Backend

```
DataShare_Backend/
├── src/
│   ├── main/java/com/openclassrooms/datashare/
│   │   ├── configuration/
│   │   │   └── logging/         ← Logging requêtes HTTP custom
│   │   │   └── security/        ← Spring Security, JWT, CORS
│   │   ├── controller/          ← endpoints REST
│   │   ├── dto/                 ← Data Transfer Objects
│   │   ├── handler/             ← exceptions métier
│   │   ├── mapper/              ← mapping DTO ↔ entité
│   │   ├── entities/            ← entités JPA
│   │   ├── repository/          ← interfaces Spring Data
│   │   ├── scheduler/           ← cronjobs
│   │   ├── service/             ← logique métier
│   │   └── utils/               ← utilitaires (FileUtils, hash)
│   └── main/resources/
│       └── application.yml
├── src/test/                    ← tests unitaires et d'intégration
└── pom.xml                      ← Gestionnaire de dépendances et de build
```

---

## 5. Lancement de l'application

### Développement

```bash
# Terminal 1 — Backend
## Option 1
cd DataShare_Backend
./mvnw spring-boot:run
## Option 2 (utilisateur windows)
.\java25.bat run

# Terminal 2 — Frontend (HTTPS)
cd DataShare_Frontend
npm run start:https
```

L'application est accessible sur `https://localhost:4200`, le backend sur `https://localhost:8443`.

### Mode E2E (tests Cypress)

```bash
# Terminal 1 — Frontend sans SSR
cd DataShare_Frontend
npm run start:e2e

# Terminal 2 — Cypress
npm run cy:open
```

### Scripts disponibles 

#### Backend
Ces commandes sont exécutables sur du windows mais adaptables sur un autre OS

| Script | Commande | Description |
|---|---|---|
| Développement HTTPS | `.\java25.bat run` | Lance le backend en HTTPS |
| Tests unitaires/intégrations | `.\java25.bat test` | Lance JUnit sur l'ensemble su projet |
| Tests unitaires/intégrations | `.\java25.bat test <Nom_Classe>` | Lance JUnit sur une classe précise |
| Tests unitaires/intégration avec coverage | `.\java25.bat jacoco` | Lance JaCoCo |
| Génération documentation | `.\java25.bat doc` | Lance Javadoc |
| UML | `.\java25.bat uml` | Génère les fichiers UML avec PlantUML |

#### Frontend

| Script | Commande | Description |
|---|---|---|
| Développement HTTPS | `npm run start:https` | Lance le frontend en HTTPS |
| Mode E2E | `npm run start:e2e` | Lance sans SSR pour les tests Cypress |
| Tests unitaires | `npm test` | Lance Jest |
| Tests E2E interactifs | `npm run cy:open` | Ouvre l'interface Cypress |
| Tests E2E headless | `npm run cy:run` | Lance Cypress en mode CI |
| Build production | `npm run build` | Génère le bundle de production |
| UML | `npm run uml` | Génère les diagrammes UML |

---

## 6. Tests

Voir [TESTING.md](./TESTING.md) pour la documentation complète des tests.

```bash
# Tests unitaires frontend
npm test

# Tests unitaires frontend avec couverture
npm test -- --coverage
## Ou
npx jest --coverage

# Tests E2E
npm run cy:run

# Tests unitaires + intégration backend
./mvnw test

# Tests backend avec rapport de couverture JaCoCo
./mvnw test jacoco:report
## Ou sur Windows
.\java25.bat jacoco
# → Rapport : target/site/jacoco/index.html

# Tests de performance k6
## En local
k6 run performance-tests/datashare-load-tests.js
## Dans le cloud
## Se connecter à Graphana Cloud et lancer le script
## performance-tests/cloud-datashare-load-tests.js
```

---

## 7. Build et déploiement

### Build frontend

```bash
cd DataShare_Frontend

# Build de production
npm run build
# → Sortie : dist/DataShare_Frontend/browser/
```

### Build backend

```bash
cd DataShare_Backend

# Build avec tests
./mvnw package

# Build sans tests
./mvnw package -DskipTests
# → JAR : target/datashare-backend-*.jar
```

---

## 8. Gestion des dépendances

### Frontend — mises à jour

```bash
# Vérifier les dépendances obsolètes
npm outdated

# Mettre à jour les dépendances mineures/patch (sans breaking changes)
npm update

# Auditer les vulnérabilités
npm audit

# État attendu
# found 0 vulnerabilities
```

### Règle de compatibilité Angular

La version de `@angular-builders/jest` doit correspondre à la version majeure d'Angular :

```
Angular 21.x → @angular-builders/jest ^21.x  ✅
Angular 21.x → @angular-builders/jest ^22.x  ❌ (breaking change)
```

### Overrides npm (dépendances transitives)

Les overrides suivants sont maintenus pour garantir 0 vulnérabilité :

```json
"overrides": {
  "esbuild": "^0.28.1",
  "webpack-dev-server": "^5.2.4",
  "uuid": "^11.1.1",
  "blake3-wasm": "^3.0.0",
  "@c4312/blake3-internal": "^3.0.0"
}
```

> **Attention** : Avant toute mise à jour majeure d'Angular, vérifier la compatibilité de `@angular-builders/jest`.

### Backend — mises à jour

```bash
# Vérifier les dépendances obsolètes
./mvnw versions:display-dependency-updates

# Mettre à jour le parent Spring Boot (avec prudence)
./mvnw versions:update-parent
```

### Procédure de mise à jour recommandée

1. Créer une branche dédiée (`chore/update-deps`)
2. Appliquer les mises à jour
3. Lancer l'ensemble des tests : `npm test && npm run cy:run && ./mvnw test`
4. Vérifier `npm audit` → 0 vulnérabilité
5. Merger uniquement si tous les tests passent

---

## 9. Procédures de maintenance courantes

### Renouvellement du certificat SSL (développement)

```bash
cd DataShare_Frontend
node ./scripts/start-https.mjs
# Le script vérifie et renouvelle automatiquement le certificat si nécessaire
```

### Réinitialisation du cache Angular

```bash
rm -rf .angular/cache
npm run start:https
```

### Réinstallation propre des dépendances frontend

```bash
rm -rf node_modules
rm package-lock.json
npm install
npm audit  # vérifier 0 vulnérabilité
```
Le nombre de vulnérabilités signalées par ``npm audit`` peut varier sans changement de dépendances, car la base de données d'avisos de sécurité est mise à jour en continu. 
Un audit régulier (hebdomadaire) est recommandé même en l'absence de modification du projet.

### Nettoyage du build Maven

```bash
./mvnw clean
./mvnw package
```

## 10. Points de surveillance recommandés

| Métrique | Seuil d'alerte | Outil |
|---|---|---|
| Taux d'erreur HTTP | > 5% | Spring Actuator / k6 |
| Temps de réponse p95 | > 3s | k6 |
| Espace disque Backblaze | > 80% | Dashboard Backblaze |
| Expiration du certificat SSL | < 30 jours | Monitoring manuel |
| Vulnérabilités npm | > 0 | `npm audit` |
| Échecs d'authentification | Pic anormal | Logs Spring Security |
