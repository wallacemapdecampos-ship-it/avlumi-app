// Verificador de erros da TELA (roda no GitHub antes de gerar o app).
// Só regras que pegam bugs de verdade — nada de estilo.
//  - no-use-before-define: usar uma variável antes de ela existir (foi o que causou a tela preta da v1.0.11)
//  - no-undef: nome que não existe (erro de digitação, import esquecido)
//  - no-dupe-keys / no-unreachable / etc.: erros clássicos
import globals from 'globals';

export default [
  {
    files: ['**/*.js', '**/*.jsx'],
    // ignora comentários eslint-disable do código da tela (eles citam regras de plugins que não usamos aqui)
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'off' },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // variables:false = só acusa quando o uso e a declaração estão na MESMA função
      // (é exatamente o caso que quebra na hora de desenhar a tela)
      'no-use-before-define': ['error', { functions: false, classes: false, variables: false }],
      'no-undef': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-duplicate-case': 'error',
      'no-unreachable': 'error',
      'no-const-assign': 'error',
      'no-func-assign': 'error',
      'no-import-assign': 'error',
      'no-self-assign': 'error',
      'valid-typeof': 'error',
      'use-isnan': 'error',
    },
  },
];
