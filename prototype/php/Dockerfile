# PROTOTYPE: validate the one-stage Base plus direct PHP archive recipe.
# The generated Build Dockerfile will replace these fixed values with lock inputs.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=UTC
ENV LANG=C.UTF-8
ENV SUPERVISOR_PHP_COMMAND="/usr/bin/php -d variables_order=EGPCS /var/www/html/artisan serve --host=0.0.0.0 --port=80"
ENV SUPERVISOR_PHP_USER="devbox"

RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

RUN echo "Acquire::http::Pipeline-Depth 0;" > /etc/apt/apt.conf.d/99custom && \
    echo "Acquire::http::No-Cache true;" >> /etc/apt/apt.conf.d/99custom && \
    echo "Acquire::BrokenProxy    true;" >> /etc/apt/apt.conf.d/99custom

# Install the Base profile packages and build tools
RUN set -eux \
    && apt-get update && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      wget \
      git \
      supervisor \
      openssh-client \
      zip \
      unzip \
      jq \
      less \
      vim \
      ripgrep \
      fd-find \
      procps \
      lsof \
      iproute2 \
      dnsutils \
      netcat-openbsd \
      rsync \
      tree \
      tzdata \
      bubblewrap \
      build-essential \
      python3 \
      python-is-python3 \
      sqlite3 \
      libcap2-bin \
      pkg-config \
      gnupg \
      dirmngr \
      xz-utils \
      libpng-dev \
      librsvg2-bin \
      fswatch \
      ffmpeg \
      pulseaudio-utils \
      sudo \
      gosu \
    && apt-get -y autoremove \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install PHP 8.5
RUN apt-get update && apt-get upgrade -y \
    && mkdir -p /etc/apt/keyrings \
    && curl -sSLo /tmp/debsuryorg-archive-keyring.deb https://packages.sury.org/debsuryorg-archive-keyring.deb \
    && dpkg -i /tmp/debsuryorg-archive-keyring.deb \
    && echo "deb [signed-by=/usr/share/keyrings/debsuryorg-archive-keyring.gpg] https://packages.sury.org/php/ noble main" > /etc/apt/sources.list.d/php.list \
    && apt-get update \
    && apt-get install -y \
        libgd3 \
        php8.5-cli \
        php8.5-dev \
        php8.5-pgsql \
        php8.5-sqlite3 \
        php8.5-gd \
        php8.5-curl \
        php8.5-mongodb \
        php8.5-imap \
        php8.5-mysql \
        php8.5-mbstring \
        php8.5-xml \
        php8.5-zip \
        php8.5-bcmath \
        php8.5-soap \
        php8.5-intl \
        php8.5-readline \
        php8.5-igbinary \
        php8.5-redis \
        php8.5-imagick \
    && curl -sLS https://getcomposer.org/installer | php -- --install-dir=/usr/bin/ --filename=composer \
    && COMPOSER_HOME=/usr/local/share/composer composer global require cpx/cpx:^2.0 \
    && ln -s /usr/local/share/composer/vendor/bin/cpx /usr/local/bin/cpx \
    && curl -sS https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor | tee /etc/apt/keyrings/pgdg.gpg > /dev/null \
    && echo "deb [signed-by=/etc/apt/keyrings/pgdg.gpg] http://apt.postgresql.org/pub/repos/apt noble-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y mysql-client \
    && apt-get install -y postgresql-client-18 \
    && apt-get -y autoremove \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

RUN setcap "cap_net_bind_service=+ep" /usr/bin/php8.5

# Create the devbox user and group
RUN userdel -r ubuntu \
    && groupadd -f -g 1000 devbox \
    && useradd -m -s /bin/bash -N -g 1000 -u 1000 devbox \
    && echo "devbox ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/devbox \
    && chmod 0440 /etc/sudoers.d/devbox

WORKDIR /workspace
USER devbox

# Install Claude Code
RUN mkdir -p /home/devbox/.claude \
    && echo '{}' > /home/devbox/.claude.json \
    && curl -fsSL https://claude.ai/install.sh | bash

# Install Codex CLI
RUN mkdir -p /home/devbox/.codex \
    && curl -fsSL https://chatgpt.com/codex/install.sh | sh

# Install Antigravity CLI
RUN mkdir -p /home/devbox/.gemini \
    && curl -fsSL https://antigravity.google/cli/install.sh | bash

# Install OMP
RUN mkdir -p /home/devbox/.omp \
    && curl -fsSL https://omp.sh/install | sh

# Set the PATH to include AI tools
ENV PATH="/home/devbox/.local/bin:${PATH}"

USER root

# Copy dotfiles
COPY prototype/php/.bash_aliases /home/devbox/.bash_aliases
COPY prototype/php/.gitconfig /home/devbox/.gitconfig
RUN chown devbox:devbox /home/devbox/.bash_aliases \
    && chown devbox:devbox /home/devbox/.gitconfig

# Copy AI dotfiles
COPY prototype/php/.claude/settings.json /home/devbox/.claude/settings.json
COPY prototype/php/.omp/agent/config.yml /home/devbox/.omp/agent/config.yml
RUN chown devbox:devbox /home/devbox/.claude/settings.json \
    && chown devbox:devbox /home/devbox/.omp/agent \
    && chown devbox:devbox /home/devbox/.omp/agent/config.yml

# Install Agent Notification Plugins
USER devbox
RUN set -eux \
    && claude plugin marketplace add ycs77/claude-code-notifications \
    && claude plugin install notification-basic-wsl@ycs77-notifications \
    && codex plugin marketplace add ycs77/codex-notifications \
    && codex plugin add notification-basic-wsl@ycs77-notifications \
    && omp plugin marketplace add ycs77/omp-notifications \
    && omp plugin install notification-basic@ycs77-notifications
USER root

COPY prototype/php/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY prototype/php/supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY php.ini /etc/php/8.5/cli/conf.d/99-devbox.ini
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 80/tcp

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
