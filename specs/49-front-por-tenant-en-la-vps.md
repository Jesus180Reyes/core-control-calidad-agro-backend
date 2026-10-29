# SPEC 49 — Front por tenant en la VPS

> **Estado:** Approved
> **Depende de:** ninguno (usa el montaje multi-tenant de `deploy/`)
> **Fecha:** 2026-10-29
> **Objetivo:** Servir el front (`core-control-calidad-agro`) de cada tenant en su propio subdominio, construido en la VPS con las URLs del `.env` de ese tenant y actualizado solo con cada push a `develop` del front.

## Por qué existe este spec

El front es TanStack Start y lee `VITE_API_URL` y `VITE_REPORT_SERVICE_URL` con `import.meta.env` (`src/infrastructure/http/core/config-http.ts`). Vite escribe esos valores dentro del bundle al compilar: el `.env` que recibe un contenedor ya construido no cambia nada.

El API y el servicio de reportes se construyen una vez en GitHub Actions y la VPS solo hace `pull`. Para el front eso daría una sola imagen con una sola URL para todos los tenants.

Se quiere que la URL exacta de cada tenant viva en su `/opt/<slug>/.env`, junto al resto de su configuración, y que ningún deploy la toque. La única forma de que el build lea ese `.env` es que el build ocurra en la VPS.

## Alcance

**Entra:**

- Un servicio `frontend` en `deploy/tenant/docker-compose.yml`, detrás del perfil `frontend`, que se construye desde `/opt/frontend-src` con las `VITE_*` del `.env` del tenant.
- Tres variables nuevas en `deploy/tenant/.env.example`: `COMPOSE_PROFILES`, `VITE_API_URL`, `VITE_REPORT_SERVICE_URL`.
- Un sitio de Caddy por tenant, `app-<slug>.<dominio>`, que manda todo a `frontend-<slug>:3000`.
- Una sección nueva en `deploy/README.md`: el clon `/opt/frontend-src`, la deploy key, cómo activar el front en un tenant y el primer build a mano.
- En el repo del front: `.github/workflows/ci.yml` con un job `check` (`npm ci`, `npm test`, `npm run build`) y un job `deploy-dev` que entra por SSH y reconstruye el front de cada tenant que lo tenga activado.

**Fuera de alcance (para specs futuros):**

- Publicar imágenes del front en GHCR.
- Configuración del front en tiempo de ejecución (una sola imagen para todos los tenants).
- Servir el front en el mismo dominio del tenant (el API seguiría en la raíz, el front no cabe sin mover el API bajo un prefijo).
- Que `nuevo-tenant.sh` active el front al crear un tenant.
- Deploy del front a producción (`main`).
- Sincronizar `deploy/` a la VPS desde CI.

## Modelo de datos

Este spec no toca la base ni `src/`. Lo nuevo es configuración.

En la VPS:

```
/opt/frontend-src/        clon del front, rama develop, compartido por todos los tenants
/opt/<slug>/.env       + COMPOSE_PROFILES, VITE_API_URL, VITE_REPORT_SERVICE_URL
/opt/plataforma/tenants/<slug>.caddy   + sitio app-<slug>.<dominio>
```

Variables nuevas del `.env` del tenant:

```
COMPOSE_PROFILES=frontend
VITE_API_URL=https://<slug>.<dominio>
VITE_REPORT_SERVICE_URL=https://<slug>.<dominio>
```

`VITE_REPORT_SERVICE_URL` es el mismo dominio del API: Caddy ya manda `/reportes/*` al servicio de reportes (snippet `api_tenant`).

Servicio nuevo del compose del tenant:

- `profiles: [frontend]`: un tenant sin `COMPOSE_PROFILES=frontend` no lo ve, y su compose se comporta como hoy.
- `build.context: /opt/frontend-src`, con `args` `VITE_API_URL` y `VITE_REPORT_SERVICE_URL` leídos del `.env`, obligatorios (`${VAR:?...}`).
- `image: frontend-${TENANT}:local`: una imagen local por tenant, nunca subida a un registro.
- `container_name: frontend-${TENANT}`, `expose: ["3000"]` (el `Dockerfile` del front sirve con `srvx` en 3000), `restart: unless-stopped`, el mismo `logging` que `api`.
- **Sin `env_file`.** El `.env` del tenant tiene `DB_PASSWORD` y `JWT_SECRET`; el front no los necesita.

Sitio de Caddy, en el `<slug>.caddy` existente, después del sitio del API:

```
app-<slug>.<dominio> {
	encode gzip
	reverse_proxy frontend-<slug>:3000
}
```

## Plan de implementación

1. `deploy/tenant/docker-compose.yml`: agregar el servicio `frontend` descrito arriba, con un comentario que explique por qué se construye en la VPS. Prueba: `docker compose config` en un tenant sin `COMPOSE_PROFILES` no lista `frontend`.
2. `deploy/tenant/.env.example`: agregar las tres variables, comentadas como opcionales.
3. `deploy/README.md`: sección "Front por tenant" con la deploy key, el clon en `/opt/frontend-src`, las variables del `.env`, el primer build (`docker compose build frontend && docker compose up -d frontend`), el sitio de Caddy y su reload.
4. `CLAUDE.md` raíz: una línea en el párrafo de deploy que diga que el compose del tenant también construye el front en la VPS desde `/opt/frontend-src`, y que es la única imagen que no viene de GHCR.
5. Repo del front: crear la rama `develop` y el environment `dev` con los secrets `DEV_SSH_HOST`, `DEV_SSH_USER`, `DEV_SSH_KEY`, `DEV_SSH_KNOWN_HOSTS` (los mismos valores que el backend).
6. Repo del front: `.github/workflows/ci.yml` con `check` en PR y push, y `deploy-dev` solo en push a `develop`. El script remoto hace `git fetch origin develop && git reset --hard origin/develop` en `/opt/frontend-src`, y en cada `/opt/*/` con `TENANT=` y `COMPOSE_PROFILES=...frontend` corre `docker compose build frontend && docker compose up -d frontend`. Termina con `docker image prune -f` y falla si algún tenant falló. `concurrency` propio (`deploy-dev-frontend`), sin cancelar el deploy en curso.
7. VPS, una vez: deploy key de solo lectura (si el repo es privado), alias `github-frontend` en `~/.ssh/config` del usuario de `DEV_SSH_USER`, `git clone -b develop` en `/opt/frontend-src` con ese usuario como dueño.
8. VPS, por tenant: copiar el compose nuevo, agregar las variables al `.env`, primer build a mano, registro DNS `app-<slug>`, sitio en `<slug>.caddy`, reload de Caddy.

## Criterios de aceptación

- [ ] En un tenant sin `COMPOSE_PROFILES=frontend`, `docker compose config --services` lista solo `api` y `reporte`.
- [ ] En un tenant con el perfil activado y sin `VITE_API_URL`, `docker compose build frontend` falla con el mensaje `falta VITE_API_URL en .env`.
- [ ] `docker inspect frontend-<slug>` no muestra `DB_PASSWORD` ni `JWT_SECRET` en su entorno.
- [ ] `https://app-<slug>.<dominio>` responde con el front y un certificado válido.
- [ ] Desde `app-<slug>`, el login llama a `https://<slug>.<dominio>/auth/login` (pestaña Network del navegador).
- [ ] Con tres tenants activados, cada front llama al API de su propio tenant.
- [ ] Un push a `develop` del front termina con `Tenants actualizados: 3, con fallo: 0`.
- [ ] Después de ese push, el `sha256sum` de cada `/opt/<slug>/.env` es el mismo que antes.
- [ ] Después de ese push, `docker ps` muestra que `api-<slug>` y `reporte-<slug>` no se reiniciaron.
- [ ] Un push a `develop` del backend no reinicia ningún `frontend-<slug>`.

## Decisiones

- **Sí:** build en la VPS. Es la única forma de que el build lea el `.env` de cada tenant.
- **No:** una imagen por tenant construida en CI y subida a GHCR. Funciona, pero las URLs vivirían en el workflow del front y no en el `.env` del tenant.
- **No:** configuración en tiempo de ejecución (una sola imagen). Con SSR la URL tiene que llegar también al servidor, y obliga a cambiar el front.
- **No:** front en el mismo dominio con el API bajo `/api`. Cambia el snippet `api_tenant` y la URL del API de los tenants existentes.
- **Sí:** subdominio `app-<slug>`. El dominio actual del tenant (API + `/reportes`) queda intacto.
- **Sí:** el servicio vive en el compose del tenant, no en una carpeta aparte. Una carpeta aparte en `/opt/frontend/<slug>` tendría el mismo nombre de proyecto de Compose que `/opt/<slug>`, y Compose vería los contenedores del API como huérfanos.
- **Sí:** perfil `frontend`. Un tenant que todavía no lleva front no cambia en nada.
- **Sí:** un solo clon compartido en `/opt/frontend-src`. Todos los tenants corren la misma versión del front.
- **Sí:** el deploy del front nombra siempre el servicio (`build frontend`, `up -d frontend`). Nunca toca `api` ni `reporte`, igual que el `deploy-dev` del backend solo toca `api`.
- **No:** `env_file` en el servicio `frontend`. Le pasaría los secretos del tenant a un contenedor que no los usa.
- **Sí:** el job `check` corre en GitHub antes del deploy. Un error de compilación falla ahí, no a mitad del build en la VPS.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Tres `npm run build` por push consumen CPU y RAM en la misma máquina que MySQL y los API | El `Dockerfile` pone los `ARG` después de `npm ci`: solo se repite el build. Los builds corren uno tras otro, no en paralelo. Si pesa, se pasa a imágenes por tenant en CI (otro spec). |
| Un `docker compose up -d` sin nombrar servicio en un tenant con el perfil activado y sin las `VITE_*` falla | Las variables se agregan al `.env` antes de copiar el compose nuevo. El mensaje de `${VAR:?...}` dice cuál falta. |
| Alguien edita a mano `/opt/frontend-src` | El deploy hace `git reset --hard`: los cambios locales se pierden. Documentado en el README. |
| El usuario de `DEV_SSH_USER` no es dueño de `/opt/frontend-src` | El README clona con ese usuario. El deploy falla en `git fetch` con un mensaje claro. |
| Las imágenes `frontend-<slug>:local` viejas llenan el disco | `docker image prune -f` al final de cada deploy. |

## Qué **no** entra en este spec

- Imágenes del front en GHCR.
- Configuración del front en tiempo de ejecución.
- Front en el mismo dominio del API.
- Activar el front desde `nuevo-tenant.sh`.
- Deploy del front a producción.
- Sincronizar `deploy/` a la VPS desde CI.

Cada uno, si llega, va en su propio spec.
