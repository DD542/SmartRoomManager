# =============================================================================
# Image du front — deux étapes.
#
# La première compile ; la seconde ne sert que des fichiers statiques. Node
# n'existe pas dans l'image finale : une application React compilée est du
# HTML, du CSS et du JavaScript, et embarquer son moteur de construction pour
# les servir reviendrait à livrer l'atelier avec le meuble.
# =============================================================================

FROM node:20-alpine AS constructeur

WORKDIR /build

# `npm ci` et non `npm install` : il installe exactement ce que décrit le
# fichier de verrouillage, sans jamais le modifier. Une construction ne doit
# pas dépendre du jour où elle est lancée.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build


# --------------------------------------------------------------------------- #

FROM nginx:1.27-alpine AS final

# Nginx tourne déjà en `nginx` pour ses processus de travail, mais son maître
# reste root pour ouvrir le port 80. Le port est décalé au-dessus de 1024 et
# le maître passe en utilisateur non privilégié.
RUN sed -i 's/^user  nginx;/# maître non privilégié : voir la directive du compose/' /etc/nginx/nginx.conf

COPY --from=constructeur /build/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Les répertoires de travail de nginx doivent appartenir à l'utilisateur qui
# l'exécute, sinon le démarrage échoue sur un cache non inscriptible.
RUN chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /var/log/nginx \
    && touch /var/run/nginx.pid && chown nginx:nginx /var/run/nginx.pid

USER nginx

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://127.0.0.1:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
