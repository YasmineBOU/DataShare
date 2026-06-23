# SECURITY.md — DataShare

## Table des matières

1. [Vue d'ensemble](#1-vue-densemble)
2. [Authentification et sessions](#2-authentification-et-sessions)
3. [Gestion des mots de passe](#3-gestion-des-mots-de-passe)
4. [Chiffrement des communications](#4-chiffrement-des-communications)
5. [Stockage des fichiers](#5-stockage-des-fichiers)
6. [Sécurité des dépendances](#6-sécurité-des-dépendances)
7. [Contrôle d'accès](#7-contrôle-daccès)
8. [Validation des données](#8-validation-des-données)

---

## 1. Vue d'ensemble

DataShare applique une certaine approche de sécurité en profondeur (defense in depth) couvrant l'ensemble des couches de l'application : authentification, chiffrement des communications, stockage sécurisé des fichiers et des mots de passe, et gestion des dépendances.

### Résumé des mesures de sécurité

| Domaine | Mesure | Statut |
|---|---|---|
| Authentification | JWT via cookie HttpOnly | ✅ |
| Mots de passe | BCrypt avec salt aléatoire | ✅ |
| Communication | HTTPS / TLS | ✅ |
| Stockage fichiers | Backblaze B2 avec chiffrement côté serveur | ✅ |
| CSRF | Désactivé (API stateless JWT) | ✅ |
| Dépendances | 0 vulnérabilité npm audit | ✅ |
| Validation | Spring Validation + validation Angular | ✅ |

---

## 2. Authentification et sessions

### JWT via cookie HttpOnly

L'authentification repose sur des tokens JWT stockés dans un cookie `HttpOnly`, ce qui les rend inaccessibles depuis JavaScript et protège contre les attaques XSS.

```java
// Génération du cookie après authentification réussie
ResponseCookie cookie = ResponseCookie.from(AUTH_TOKEN_COOKIE_NAME, jwtToken)
    .httpOnly(true)
    .secure(true)
    .sameSite("None")
    .maxAge(AUTH_COOKIE_MAX_AGE_SECONDS)  // 1 heure
    .path("/")
    .build();
```

### Propriétés du cookie d'authentification

| Attribut | Valeur | Rôle |
|---|---|---|
| `HttpOnly` | `true` | Inaccessible depuis JavaScript → protection XSS |
| `Secure` | `true` | Transmis uniquement via HTTPS |
| `SameSite` | `None` | Nécessaire pour les requêtes cross-origin (frontend/backend séparés) |
| `Max-Age` | 3600s (1h) | Expiration automatique de la session |
| `Path` | `/` | Valide sur l'ensemble de l'application |

### API stateless

L'application est configurée en mode **stateless** — aucune session serveur n'est créée ou maintenue. Chaque requête est authentifiée indépendamment via le JWT contenu dans le cookie.

```java
.sessionManagement(management ->
    management.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
```

### Filtrage des requêtes

Un filtre JWT (`JwtAuthenticationFilter`) valide le token à chaque requête entrante et rejette automatiquement les tokens invalides ou expirés avec une réponse `401 Unauthorized`.

### Endpoints publics

Les endpoints suivants sont accessibles sans authentification, conformément aux exigences fonctionnelles de l'application :

```java
public static final String[] PUBLIC_ENDPOINTS = {
    "/api/register",      // inscription
    "/api/login",         // connexion
    "/api/logout",        // déconnexion
    "/api/files/upload",  // upload (accessible aux utilisateurs non connectés)
    "/api/files/download",// téléchargement (accessible via token de fichier)
    "/api/files/info"     // métadonnées fichier (accessible via token de fichier)
};
```

---

## 3. Gestion des mots de passe

### Stockage — BCrypt

Les mots de passe ne sont jamais stockés en clair. BCrypt est utilisé avec un salt aléatoire généré automatiquement à chaque hachage, ce qui protège contre les attaques par tables arc-en-ciel (Rainbow Table Attacks).

```java
@Bean
public PasswordEncoder passwordEncoder() {
    return new BCryptPasswordEncoder();
}
```

BCrypt intègre nativement le salt dans le hash produit — deux hachages du même mot de passe produiront des valeurs différentes.

### Politique de complexité — Création de compte

La création d'un compte exige un mot de passe respectant les critères suivants :

| Critère | Valeur |
|---|---|
| Longueur minimale | 8 caractères |
| Lettre minuscule | Au moins 1 |
| Lettre majuscule | Au moins 1 |
| Chiffre | Au moins 1 |
| Caractère spécial | Au moins 1 (`@$!%*?&`) |

Validation côté frontend (Angular) :

```typescript
// register.ts
export const REGISTER_CONFIG = {
  PASSWORD_MIN_LENGTH: 8,
  PASSWORD_REGEX: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/
};
```

### Politique de complexité — Protection de fichier

La protection optionnelle d'un fichier par mot de passe exige :

| Critère | Valeur |
|---|---|
| Longueur minimale | 6 caractères |
| Combinaison | Au moins 1 lettre + 1 chiffre |

```typescript
// config.ts
export const FILE_CONFIG = {
  PASSWORD_MIN_LENGTH: 6,
  PASSWORD_REGEX: /^(?=.*[a-zA-Z])(?=.*[0-9]).{6,}$/
};
```

Validation côté backend (Spring) :

```java
// FileUploadDTO.java
@Size(min = 6, message = "File password must be at least 6 characters long")
private String filePassword;
```

Le mot de passe de fichier est haché avec BCrypt avant persistance en base de données, au même titre que les mots de passe utilisateurs.

---

## 4. Chiffrement des communications

### HTTPS / TLS

L'ensemble des communications entre le client et le serveur est chiffré via HTTPS avec un certificat SSL. En développement, un certificat auto-signé est généré automatiquement via un script dédié.

```bash
# Génération du certificat SSL (développement)
node ./scripts/start-https.mjs

# Lancement de l'application en HTTPS
npm run start:https
```

Configuration Angular (`angular.json`) :

```json
"development": {
  "ssl": true,
  "sslCert": ".certs/localhost.pem",
  "sslKey": ".certs/localhost-key.pem",
  "port": 4200
}
```

### Intercepteur HTTP Angular

Toutes les requêtes HTTP émises par le frontend incluent le cookie d'authentification grâce à l'intercepteur `tokenInterceptor` :

```typescript
// token.interceptor.ts
export const tokenInterceptor: HttpInterceptorFn = (req, next) => {
  const clonedReq = req.clone({
    withCredentials: true  // inclut les cookies dans toutes les requêtes
  });
  return next(clonedReq);
};
```

### Configuration CORS

Les requêtes cross-origin sont strictement contrôlées — seul le frontend autorisé peut interagir avec l'API backend.

---

## 5. Stockage des fichiers

### Backblaze B2

Les fichiers uploadés sont stockés sur **Backblaze B2**, un service de stockage objet compatible S3. Le stockage local est évité pour limiter la surface d'attaque et déléguer la sécurité physique à un prestataire spécialisé.

### Chiffrement côté serveur (SSE)

Backblaze B2 propose un **chiffrement côté serveur (Server-Side Encryption)** sur tous les fichiers stockés. Les fichiers sont chiffrés au repos et déchiffrés à la volée lors de l'accès.

### Accès via URL présignées

Les fichiers ne sont jamais exposés directement. L'accès est contrôlé via des **URL présignées à durée limitée** générées par le backend au moment du téléchargement :

```java
// FileService.java
URL presignedUrl = backblazeB2Service.generatePresignedUrl(
    key,
    Duration.ofDays(expirationDays)
);
```

Ce mécanisme garantit que :
- Un fichier sans token valide est inaccessible
- Les URLs expirent automatiquement après la durée configurée
- Aucun accès direct au stockage n'est possible sans passer par l'API

### Vérification d'intégrité (BLAKE3)

À chaque upload, un hash BLAKE3 du fichier est calculé côté client et vérifié côté serveur :

```java
// FileService.java
String fileHash = FileUtils.calculateFileHash(uploadedFile);
if (!fileHash.equals(fileData.getHash())) {
    throw new FileHashMismatchException("File hash mismatch");
}
```

Cette vérification garantit l'intégrité du fichier — tout fichier corrompu ou altéré en transit est rejeté.

### Types de fichiers interdits

Les extensions de fichiers potentiellement dangereuses sont bloquées à l'upload :

```typescript
// config.ts (frontend)
FORBIDDEN_FILE_TYPES: ['exe', 'bat', 'cmd', 'sh', 'js']
```

La même vérification est effectuée côté backend :

```java
// FileService.java
if (fileProperties.getForbiddenExtensions().contains(fileExtension.toLowerCase())) {
    throw new FileExtensionException(
        "Files with extension '" + fileExtension + "' are not allowed"
    );
}
```

### Limite de taille

Les fichiers sont limités à **1 Go** maximum par upload.

Frontend :

```typescript
// config.ts (frontend)
export const FILE_CONFIG = {
  MAX_FILE_SIZE: 1 * 1024 * 1024 * 1024  // 1 GB
  ...
}
```
Backend : fichier `application.yml`

```YAML
  servlet:
    multipart:
      enabled: true
      max-file-size: 1GB
      max-request-size: 1100MB # Allow some overhead for multipart request headers
```

---

## 6. Sécurité des dépendances

### npm audit — 0 vulnérabilité

Les dépendances frontend sont auditées régulièrement avec `npm audit`. Le projet est maintenu à **0 vulnérabilité** grâce à l'utilisation de la fonctionnalité `overrides` de npm pour forcer des versions patchées des dépendances transitives :

```json
// package.json
"overrides": {
  "esbuild": "^0.28.1",
  "webpack-dev-server": "^5.2.4",
  "uuid": "^11.1.1"
}
```

```bash
# Vérifier l'état des vulnérabilités
npm audit

# Résultat attendu
found 0 vulnerabilities
```

---

## 7. Contrôle d'accès

### Endpoints protégés

Tous les endpoints non listés dans `PUBLIC_ENDPOINTS` requièrent une authentification valide. Un utilisateur non authentifié reçoit une réponse `401 Unauthorized`.

```java
.authorizeHttpRequests(authorize -> authorize
    .requestMatchers("/actuator/**").permitAll()
    .requestMatchers(SecurityConstants.PUBLIC_ENDPOINTS).permitAll()
    .anyRequest().authenticated())
```

### Isolation des données utilisateur

Chaque utilisateur n'accède qu'à ses propres fichiers. Le listing des fichiers filtre systématiquement par email utilisateur :

```java
// FileController.java: Lister uniquement les fichiers de l'utilisateur authentifié

  /**
   * Lists files accessible by a given user.
   *
   * @param authenticatedUser Authenticated user.
   * @param email             Email of the user whose files are to be listed.
   * @return ResponseEntity with a success message and the list of files.
   */
  @GetMapping(value = "/list")
  @PreAuthorize("isAuthenticated()")
  public ResponseEntity<?> listFiles(
    @AuthenticationPrincipal User authenticatedUser,
    @RequestParam String email) 
  {
    return ResponseEntity.ok(Map.of(
      "message", "Files retrieved successfully !",
      "files", fileService.listFiles(authenticatedUser, email)
    ));
  }
```

### Tokens de fichier uniques

Chaque fichier uploadé reçoit un token unique généré à partir du hash du fichier et de sa clé de stockage :

```java
String fileToken = FileUtils.generateUniqueFileToken(fileHash, key, 20);
```

Ce token est le seul moyen d'accéder aux métadonnées ou au téléchargement d'un fichier — sans token valide, le fichier est inaccessible.

Actuellement, le token est généré sur une longueur de 20 caractères qui peut être sujet à modification suivant la politique de sécurité en vigueur.

---

## 8. Validation des données

### Double validation (frontend + backend)

Toutes les données saisies par l'utilisateur sont validées à deux niveaux :

**Frontend (Angular)** — validation réactive avec `Validators` :
- Format email
- Complexité et longueur des mots de passe via regex
- Champs obligatoires
- Types et tailles de fichiers

**Backend (Spring)** — validation via annotations Jakarta :
```java
@NotNull(message = "File is required")
@NotBlank(message = "Filename is required")
@NotBlank(message = "Hash is required")
@NotNull(message = "Expiration days is required")
@Min(value = 1, message = "Expiration days must be a positive number")
@Email(message = "Email should be valid")
```

La validation backend est la ligne de défense finale — elle s'applique indépendamment du frontend.