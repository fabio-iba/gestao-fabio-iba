# Gestão Fabio Iba (GitHub Pages)

Os painéis da coordenação funcionando fora do Claude:

- **Site:** GitHub Pages (este repositório).
- **Dados:** planilha *Gestão Fabio Iba - Banco de dados*, com uma aba por coleção.
- **Arquivos:** pasta *Arquivos dos painéis* no Google Drive.
- **Ligação entre os dois:** um Apps Script ligado à planilha.

| Página | Arquivo |
|---|---|
| Página inicial | `index.html` |
| Gestão Docente | `gestao-docente.html` |
| Gestão Regulatória | `gestao-regulatoria.html` |
| Projetos dos Cursos | `projetos.html` |
| Calendário Docente | `calendario.html` |
| Validação de Materiais | `validacao.html` |
| Roteiro do Módulo | `roteiro.html` |
| Escolha de disciplinas (links dos professores) | `preferencias.html` |
| Importação dos dados (uso único) | `importar.html` |

## Passo a passo

### 1. Apps Script (backend)

1. Abra a planilha **Gestão Fabio Iba - Banco de dados**, que está na pasta *Gestão Fabio Iba - Site* do seu Drive.
2. Vá em **Extensões > Apps Script**.
3. Apague o conteúdo de `Código.gs` e cole o de `apps-script/Code.gs`.
4. Em **Configurações do projeto** (engrenagem), marque *Mostrar arquivo de manifesto "appsscript.json" no editor*. Depois cole nele o conteúdo de `apps-script/appsscript.json`.
5. Ainda em **Configurações do projeto > Propriedades do script**, adicione as propriedades:
   - `CHAVE`: uma senha sua, por exemplo uma frase longa. Ela é pedida no site na primeira vez.
   - `ANTHROPIC_KEY` (opcional): chave da API da Anthropic. É ela que liga as funções de IA.
6. No editor, escolha a função `autorizar` e clique em **Executar**. Aceite as permissões pedidas: Planilhas, Drive, Documentos e serviço externo.
7. Clique em **Implantar > Nova implantação > Tipo: App da Web**:
   - *Executar como:* **Eu**
   - *Quem pode acessar:* **Qualquer pessoa**

   Clique em **Implantar** e copie o endereço que termina em `/exec`.

### 2. GitHub Pages

1. Crie um repositório no GitHub, por exemplo `gestao-fabio-iba`, e envie os arquivos desta pasta.
2. Em `config.js`, troque `COLE_AQUI_O_ENDERECO_DO_APPS_SCRIPT` pelo endereço `/exec` copiado no passo anterior.
3. No repositório, vá em **Settings > Pages > Source: Deploy from a branch**, escolha `main` e `/ (root)`, e salve.
4. Em 1 ou 2 minutos o site abre em `https://SEU-USUARIO.github.io/gestao-fabio-iba/`.

### 3. Importar os dados (uma vez)

1. Abra `.../importar.html`.
2. Digite a chave (a propriedade `CHAVE`).
3. Escolha os arquivos `dados-paineis.json` e `arquivos-regulatorio.json`. Eles **não** vão para o GitHub.
4. Clique em **Importar**.

## Avisos

- **Repositório público.** O repositório pode ser público, porque os dados não ficam nele. Eles ficam só na planilha e no Drive, protegidos pela chave. Nunca envie os arquivos `.json` de dados ao GitHub.
- **Depois de alterar o Apps Script.** Use **Implantar > Gerenciar implantações > Editar > Nova versão**, para manter o mesmo endereço.
- **Trocar a chave.** Altere a propriedade `CHAVE`. No navegador, a chave antiga deixa de valer e o site pede a nova.
