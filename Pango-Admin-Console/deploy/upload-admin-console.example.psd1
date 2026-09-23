@{
  # SSH server and account. SSH key authentication is recommended.
  SshHost = '47.107.82.201'
  SshPort = 22
  SshUser = 'root'
  IdentityFile = ''

  # Existing server directory. It must already contain config/database.env.
  RemotePath = '/home/sjchen/adminconsole'
  Pm2ProcessName = 'pango_console'
}
