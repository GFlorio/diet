import js from '@eslint/js';
import globals from 'globals';
import importPlugin from 'eslint-plugin-import';
import promisePlugin from 'eslint-plugin-promise';
import playwrightPlugin from 'eslint-plugin-playwright';
import unusedImportsPlugin from 'eslint-plugin-unused-imports';
import path from 'path';

export default [
    {
        ignores: [
            'frontend/dist/**',
            'frontend/node_modules/**',
            'frontend/playwright-report/**',
            'frontend/public/**'
        ]
    },
    // Frontend base JS config
    {
        files: ['frontend/src/**/*.js', 'frontend/tests-e2e/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.browser
            }
        },
        plugins: {
            import: importPlugin,
            promise: promisePlugin,
            playwright: playwrightPlugin,
            'unused-imports': unusedImportsPlugin
        },
        rules: {
            ...js.configs.recommended.rules,
            eqeqeq: ['error', 'always'],
            curly: ['error', 'all'],
            'dot-notation': 'error',
            'no-implied-eval': 'error',
            'no-return-await': 'error',
            'prefer-const': ['error', { destructuring: 'all' }],
            'no-unused-vars': ['error', { args: 'none', ignoreRestSiblings: true }],
            'import/no-unresolved': ['error'],
            'import/no-duplicates': 'error',
            'import/export': 'error',
            'import/no-extraneous-dependencies': ['error', { devDependencies: true }],
            'max-statements-per-line': ['error', { max: 2 }],
            'promise/no-return-wrap': 'error',
            'promise/param-names': 'error',
            'promise/no-new-statics': 'error',
            'promise/no-nesting': 'warn',
            'promise/no-promise-in-callback': 'warn',
            'promise/no-callback-in-promise': 'warn',
            'unused-imports/no-unused-imports': 'error',
            'unused-imports/no-unused-vars': [
                'warn',
                {
                    vars: 'all',
                    varsIgnorePattern: '^_',
                    args: 'after-used',
                    argsIgnorePattern: '^_'
                }
            ]
        }
    },
    {
        files: ['frontend/src/tests/**/*.js', 'frontend/tests-e2e/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.node,
                describe: 'readonly',
                it: 'readonly',
                test: 'readonly',
                expect: 'readonly',
                beforeAll: 'readonly',
                beforeEach: 'readonly',
                afterAll: 'readonly',
                afterEach: 'readonly',
                browser: 'readonly',
                page: 'readonly',
                context: 'readonly'
            }
        },
        rules: {
            'playwright/no-focused-test': 'error',
            'playwright/no-skipped-test': 'warn'
        }
    }
];
