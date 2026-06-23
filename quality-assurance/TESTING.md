# TESTING.md — DataShare

## Table des matières

1. [Vue d'ensemble](#1-vue-densemble)
2. [Stratégie de tests](#2-stratégie-de-tests)
3. [Tests unitaires — Frontend (Angular)](#3-tests-unitaires--frontend-angular)
4. [Tests unitaires — Backend (Spring Boot)](#4-tests-unitaires--backend-spring-boot)
5. [Tests d'intégration — Backend](#5-tests-dintégration--backend)
6. [Tests End-to-End — Cypress](#6-tests-end-to-end--cypress)
7. [Couverture de code](#8-couverture-de-code)
8. [Exécution des tests](#9-exécution-des-tests)

---

## 1. Vue d'ensemble

La stratégie de tests couvre l'ensemble des couches applicatives selon la pyramide de tests classique.

```
         /\
        /E2E\          Cypress — tests end-to-end (UI + flux complets)
       /------\
      /  Intég. \      Spring Boot Test — tests d'intégration API
     /------------\
    /   Unitaires  \   Jest (Angular) + JUnit/Mockito (Spring Boot)
   /________________\
```

### Technologies utilisées

| Couche | Outil | Version |
|---|---|---|
| Tests unitaires Frontend | Jest + jest-preset-angular | 30.x |
| Tests unitaires Backend | JUnit 5 + Mockito | Spring Boot 4.x |
| Tests d'intégration Backend | Spring Boot Test + MockMvc | Spring Boot 4.x |
| Tests E2E | Cypress | 15.x |
| Tests de performance | k6 | 0.x |

---

## 2. Stratégie de tests

### Fonctionnalités critiques testées

| Fonctionnalité | Unitaire | Intégration | E2E |
|---|:---:|:---:|:---:|
| Inscription utilisateur | ✅ | ✅ | ✅ |
| Connexion / Déconnexion | ✅ | ✅ | ✅ |
| Upload de fichier | ✅ | ✅ | ✅ |
| Download de fichier | ✅ | ✅ | ✅ |
| Listing des fichiers | ✅ | ✅ | ✅ |
| Suppression de fichier | ✅ | ✅ | ✅ |
| Validation des formulaires | ✅ | — | ✅ |
| Protection par mot de passe | ✅ | ✅ | ✅ |
| Expiration des fichiers | ✅ | ✅ | ✅ |
| Gestion des erreurs | ✅ | ✅ | ✅ |

### Principes appliqués

- **Isolation** : chaque test unitaire mocke ses dépendances (Jest spies, Mockito)
- **Fixtures centralisées** : les données de test sont dans `cypress/fixtures/` et réutilisées entre les tests E2E
- **Mock backend** : un mock server Cypress (`mock-server.ts`) centralise toutes les interceptions HTTP pour les tests E2E
- **Indépendance** : chaque test est indépendant et peut s'exécuter seul

---

## 3. Tests unitaires — Frontend (Angular)

### Localisation

```
src/
  app/
    core/
      service/
        auth.service.spec.ts       ← AuthService
    pages/
      login/
        login.spec.ts              ← composant Login
      register/
        register.spec.ts           ← composant Register
      file-listing/
        file-listing.spec.ts       ← composant FileListing
        ...
```

### Exemple — AuthService

```typescript
// auth.service.spec.ts
describe('AuthService', () => {
  describe('isAuthenticated', () => {
    it('should return false by default', () => {
      expect(authService.isAuthenticated()).toBe(false);
    });

    it('should return true after successful loadCurrentUser', () => {
      authService.loadCurrentUser().subscribe();
      httpMock.expectOne('/api/auth/me').flush({
        authenticated: true,
        email: 'test@example.com'
      });
      expect(authService.isAuthenticated()).toBe(true);
    });
  });

  describe('logout', () => {
    it('should call logout endpoint and clear currentEmail', () => {
      authService.logout().subscribe();
      const req = httpMock.expectOne('/api/logout');
      expect(req.request.method).toBe('POST');
      req.flush({});
      expect(authService.currentEmail).toBeNull();
    });
  });
});
```

### Exemple — FileListing

```typescript
// file-listing.spec.ts
describe('FileListing — ngOnInit', () => {
  it('should redirect to login if not authenticated', () => {
    jest.spyOn(authService, 'loadCurrentUser').mockReturnValue(
      of({ authenticated: false, email: null })
    );
    component.ngOnInit();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('should load files if authenticated', () => {
    component.ngOnInit();
    expect(component.userFiles).toHaveLength(2);
    expect(component.filteredFiles).toHaveLength(1); // filtre 'active' par défaut
  });
});
```

### Exécution

```bash
# Tous les tests unitaires frontend
npm test

# Avec couverture
npx jest --coverage

# Un fichier spécifique
npx jest src/app/core/service/auth.service.spec.ts
```

---

## 4. Tests unitaires — Backend (Spring Boot)

### Localisation

```
src/test/java/com/openclassrooms/datashare/
  service/
    FileServiceTest.java
    UserServiceTest.java
  dto/
    FileUploadDTOTest.java
    ...
```

### Exemple — FileService

```java
@ExtendWith(MockitoExtension.class)
class FileServiceTest {

    @Mock 
    private FileDataRepository fileDataRepository;
    
    @Mock 
    private BackblazeB2Service backblazeB2Service;
    
    @Mock 
    private UserRepository userRepository;
    
    @Mock 
    private FileRepository fileRepository;

    @InjectMocks 
    private FileService fileService;

    ...

    @Nested
    @Tag("listFiles")
    @DisplayName("Tests for listFiles method")
    class ListFilesTests {
      private static Stream<Arguments> provideInvalidUserOrEmail() {
        return Stream.of(
          // authenticatedUser = null, email = any
          Arguments.of(null, EMAIL),

          // authenticatedUser = any, email = null
          Arguments.of(new User(), null));
      }

      @ParameterizedTest()
      @MethodSource("provideInvalidUserOrEmail")
      @DisplayName("Given a null authenticated user and/or email, when listFiles is called, then IllegalArgumentException is thrown.")
      public void test_listFiles_invalid_input_throws_IllegalArgumentException(
        User authenticatedUser,
        String email) {
        // THEN
        Assertions.assertThrows(
          IllegalArgumentException.class,
          () -> fileService.listFiles(authenticatedUser, email));
      }

      @Test
      @DisplayName("Given a valid authenticated user and email, when listFiles is called, then the list of files is returned")
      public void test_listFiles_valid_input_return_list_of_files() {
        // GIVEN
        ArrayList<FileInfoDTO> expectedFiles = new ArrayList<FileInfoDTO>();
        when(fileRepository.findFilesByEmail(EMAIL)).thenReturn(expectedFiles);

        // WHEN
        Iterable<FileInfoDTO> retrievedFiles = fileService.listFiles(new User(), EMAIL);

        // THEN
        verify(fileRepository, times(1)).findFilesByEmail(EMAIL);
        assertThat(retrievedFiles).isEqualTo(expectedFiles);
      }
    }
}
```

### Exécution

```bash
# Tous les tests backend
./mvnw test
## Windows
.\java25.bat test

# Un test spécifique
./mvnw test -Dtest=FileServiceTest
## Windows
.\java25.bat test FileServiceTest

# Avec rapport de couverture (JaCoCo)
./mvnw test jacoco:report
## Windows
.\java25.bat jacoco
```

---

## 5. Tests d'intégration — Backend

### Localisation

```
src/test/java/com/openclassrooms/datashare/
  controller/
    FileControllerTest.java
    UserControllerTest.java
```

### Exemple — FileController

```java
@WebMvcTest(FileController.class)
@AutoConfigureMockMvc(addFilters = false)
@Import(FileExceptionHandler.class)
class FileControllerTest {

    @Autowired 
    private MockMvc mockMvc;

    @MockitoBean
    private FileService fileService;

    @MockitoBean
    private UserRepository userRepository;
    ...

    @Nested
    @Tag("listFile")
    @DisplayName("Tests for list endpoint")
    class ListFileTests {

      private static final String EMAIL = "user@example.com";

      @BeforeEach
      public void setUp() {
          URL = URLS_BY_METHOD.get("list");
      }

      @Test
      @DisplayName("Given an authenticated user and a valid email, when listFiles is called, then return success response")
      @WithMockUser
      public void test_listFiles_withValidRequest_shouldReturnSuccessResponse() throws Exception {
        // GIVEN
        User authenticatedUser = new User();
        authenticatedUser.setEmail(EMAIL);

        List<FileInfoDTO> files = List.of(
          new FileInfoDTO(1L, "file1.pdf", "fileToken1", 1024L, null, null, false),
          new FileInfoDTO(2L, "file2.pdf", "fileToken2", 2048L, null, null, false));

        when(fileService.listFiles(authenticatedUser, EMAIL)).thenReturn(files);

        // WHEN & THEN
        mockMvc.perform(MockMvcRequestBuilders.get(URL)
          .param("email", EMAIL)
          .contentType(MediaType.APPLICATION_JSON)
          .accept(MediaType.APPLICATION_JSON))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.message").value("Files retrieved successfully !"))
          .andExpect(jsonPath("$.files").isArray())
          .andExpect(jsonPath("$.files.length()").value(2))
          .andExpect(jsonPath("$.files[0].filename").value("file1.pdf"))
          .andExpect(jsonPath("$.files[1].filename").value("file2.pdf"));
      }
    }
}
```


---

## 6. Tests End-to-End — Cypress

### Architecture

```
cypress/
  e2e/
    login.cy.ts              ← authentification
    register.cy.ts           ← inscription
    file-upload.cy.ts        ← upload de fichier
    file-download.cy.ts      ← téléchargement
    user-dashboard.cy.ts     ← dashboard utilisateur 
                              (historique/ajout/téléchargement/suppression fichier + logout)
  fixtures/
    users.json               ← utilisateurs de test
    files.json               ← fichiers de test 
                              (générés automatiquement depuis le script 'generateFilesFixture.js')
    cookies.json             ← configuration cookies
    generateFilesFixture.js  ← Script de génération de fixture de fichiers avec date d'expiration variables
  support/
    commands.ts              ← commandes personnalisées (cy.login())
    e2e.ts                   ← configuration globale + mock backend
    mock-server.ts           ← interceptions HTTP centralisées
```

### Mock backend centralisé

Toutes les requêtes HTTP sont interceptées par `mock-server.ts`, ce qui rend les tests indépendants du backend réel :

```typescript
// mock-server.ts — exemple d'interception
cy.intercept('POST', '/api/login', (req) => {
  if (req.body.email === users.registeredUser.email) {
    req.reply({ statusCode: 200, body: { message: 'Login successful' } });
  } else {
    req.reply({ statusCode: 401, body: { message: 'Incorrect credentials' } });
  }
});
```

### Commande personnalisée — `cy.login()`

```typescript
// commands.ts
Cypress.Commands.add('login', () => {
  const testUser = users.registeredUser;
  const sessionName = `user-session-${testUser.email}-upload-landing`;
  
  cy.session(
    [sessionName, 'v2'], 
    () => {
      // 1. Visit the login page to initialize the session
      cy.visit('/login');

      // 2. Fill in the login form with the test user's credentials
      cy.get('input[id="email"]').type(testUser.email);
      cy.get('input[id="password"]').type(testUser.password);

      // 3. Intercept the login request to capture the response
      cy.intercept('POST', '/api/login').as('loginRequest');

      // 4. Submit the login form
      cy.contains('button', 'Connexion').click();

      // 5. Wait for the login request to complete and assert the response status
      cy.wait('@loginRequest').its('response.statusCode').should('eq', 200);

      // 6. Verify that the JWT cookie is set in the browser after login
      cy.getCookie(cookies.tokenKey).then((cookie) => {
        if (!cookie) {
          throw new Error(`JWT cookie "${cookies.tokenKey}" not found after login. Ensure the backend sets the cookie correctly.`);
        }
        cy.wrap(cookie.value).as(cookies.tokenKey);
      });

      // 7. Force a stable authenticated landing page for downstream tests
      cy.visit('/files/upload', { timeout: 10000, failOnStatusCode: false });
    },
    {
      // Cache the session to reuse it across specs
      cacheAcrossSpecs: true,
      validate: () => {
        cy.getCookie(cookies.tokenKey).should('exist');
      },
    }
  );
```

### Exemple — Upload de fichier

```typescript
// file-upload.cy.ts
describe('File Upload page', () => {
  ...
  
  describe('Invalid file selection', () => {

    it('should show alert and stay on initial state for forbidden extension', () => {
      cy.on('window:alert', (text) => {
        expect(text).to.contains('n\'est pas autorisé');
      });

      cy.get('input[id="file-upload"]').selectFile({
        contents: Cypress.Buffer.from('malicious content'),
        fileName: 'virus.exe',
        mimeType: 'application/octet-stream',
      }, { force: true });

      // Should remain on the initial state
      cy.contains('h1', 'Tu veux partager un fichier ?').should('be.visible');
      cy.contains('h1', 'Ajouter un fichier').should('not.exist');
    });

    it('should show alert for oversized file', () => {
      cy.on('window:alert', (text) => {
        expect(text).to.contains('trop volumineux');
      });

      // Create a file larger than the maximum allowed size (1GB) using Cypress.Buffer
      cy.window().then((win) => {
        // Stub pour simuler un fichier trop lourd
        const largeFile = new win.File(
          [new win.Blob(['x'])],
          'big-file.pdf',
          { type: 'application/pdf' }
        );
        Object.defineProperty(largeFile, 'size', { value: 2 * 1024 * 1024 * 1024 }); // 2GB

        const dataTransfer = new win.DataTransfer();
        dataTransfer.items.add(largeFile);

        const input = win.document.getElementById('file-upload') as HTMLInputElement;
        Object.defineProperty(input, 'files', { value: dataTransfer.files });
        input.dispatchEvent(new win.Event('change', { bubbles: true }));
      });

      cy.contains('h1', 'Tu veux partager un fichier ?').should('be.visible');
    });
  });  
});
```

### Exécution

```bash
# Lancer l'application 
npm run start:e2e

# Mode interactif (dans un second terminal)
npm run cy:open

# Mode headless (CI/CD)
npm run cy:run
```

---

## 7. Couverture de code

### Frontend — Jest

**Seuil atteint : > 90%**

```
Coverage summary
Statements   : 94.31% (581/616)
Branches     : 81.25% (143/176)
Functions    : 95%    (114/120)
Lines        : 93.99% (548/583)
```

Générer le rapport :
```bash
npx jest --coverage
# Rapport HTML dans : coverage/lcov-report/index.html
```

### Backend — JaCoCo

**Seuil atteint : > 70%**

```
Element               Coverage
Instructions          77%
Branches              72%
```

Générer le rapport :
```bash
./mvnw test jacoco:report
# Windows
.\java25 jacoco
# Rapport HTML dans : target/site/jacoco/index.html

```

### Zones non couvertes (intentionnel)

| Zone | Raison |
|---|---|
| Classes de configuration Spring | Beans de configuration, testés via intégration |
| DTOs sans logique | Getters/setters générés par Lombok |

---

## 8. Exécution des tests

### Prérequis

```bash
# Frontend
node >= 22.x
npm >= 10.x
cypress >= 15.x

# Backend
Java == 25
Maven >= 3.9.x

```

### Commandes récapitulatives

```bash
# ── FRONTEND ──────────────────────────────────
# Tests unitaires
npm test

# Tests unitaires avec couverture
npx jest --coverage

# Tests E2E (interactif)
npm run start:e2e      # terminal 1
npm run cy:open        # terminal 2

# Tests E2E (headless CI)
npm run cy:run

# ── BACKEND ───────────────────────────────────
# Tests unitaires + intégration
./mvnw test

# Avec rapport JaCoCo
./mvnw test jacoco:report
```