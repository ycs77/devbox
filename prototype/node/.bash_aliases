alias ..='cd ..'
alias ...='cd ../..'
alias c='clear'
alias g='git'
alias ccc='claude --dangerously-skip-permissions'
alias ccx='codex --sandbox workspace-write --ask-for-approval never'
alias ggg='agy --dangerously-skip-permissions'

function mkcd() {
  mkdir "$1"
  cd "$1"
}

function killport() {
  sudo kill -9 $(sudo lsof -t -i:"$1")
}

# Laravel Artisan
alias pa='php artisan'
alias pav='php artisan serve'
alias pam='php artisan migrate'
alias pams='php artisan migrate --seed'
alias pamr='php artisan migrate:rollback'
alias pamf='php artisan migrate:fresh'
alias pamfs='php artisan migrate:fresh --seed'
alias pas='php artisan db:seed'
alias par='php artisan route:list'
alias paq='php artisan queue:work'
alias pah='php artisan horizon'
alias pat='php artisan tinker'
alias phpunit='./vendor/bin/phpunit --colors=always'
alias pu='phpunit'
alias pest='./vendor/bin/pest --colors=always'
alias p='pest'
alias pint='./vendor/bin/pint'
alias phpstan='./vendor/bin/phpstan analyse --ansi'
alias rector='./vendor/bin/rector'

# NPM (requires @antfu/ni)
alias nv='nr dev' # nd exists in @antfu/ni
alias nb='nr build'
alias nll='nr lint' # nl is a Linux command
alias nlf='nr lint --fix'
alias nf='nr fmt'
alias nfc='nr fmt --check'
alias nc='nr check'
alias nt='nr test'
alias ntr='nr test --run'
