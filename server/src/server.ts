import
{
  createConnection,
  TextDocuments,
  Diagnostic,
  ProposedFeatures,
  InitializeParams,
  DidChangeConfigurationNotification,
  CompletionItem,
  TextDocumentPositionParams,
  TextDocumentSyncKind,
  InitializeResult
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { LSPContext } from './lsp-context';
import { templatesInternos } from './lsp-internal-templates';
import { LSPParser } from './lsp-parser';
import { checkSintaxe, parserContent } from './lsp-parser-utils';

const connection = createConnection(ProposedFeatures.all);

const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;

connection.onInitialize((params: InitializeParams) =>
{
  const capabilities = params.capabilities;

  LSPContext.loadInternalTemplates(templatesInternos);

  hasConfigurationCapability = !!(capabilities.workspace && !!capabilities.workspace.configuration);
  hasWorkspaceFolderCapability = !!(capabilities.workspace && !!capabilities.workspace.workspaceFolders);
  hasDiagnosticRelatedInformationCapability = !!(
    capabilities.textDocument &&
    capabilities.textDocument.publishDiagnostics &&
    capabilities.textDocument.publishDiagnostics.relatedInformation
  );

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,

      completionProvider: { resolveProvider: true, triggerCharacters: ['.'] },
      signatureHelpProvider: { triggerCharacters: ['(', ','] },

      hoverProvider: {}
    }
  };

  if (hasWorkspaceFolderCapability)
  {
    result.capabilities.workspace = {
      workspaceFolders: {
        supported: true
      }
    };
  }

  return result;
});

connection.onInitialized(() =>
{
  if (hasConfigurationCapability)
  {
    connection.client.register(DidChangeConfigurationNotification.type, undefined);
  }

  if (hasWorkspaceFolderCapability)
  {
    connection.workspace.onDidChangeWorkspaceFolders(_event =>
    {
      connection.console.log('Workspace folder change event received.');
    });
  }

  LSPParser.initialise().then();
});

interface ILSPSettings
{
  maxNumberOfProblems: number;
  enabledSyntaxDiagnostic: boolean;
}

const defaultSettings: ILSPSettings = {
  maxNumberOfProblems: 1000,
  enabledSyntaxDiagnostic: false
};

let globalSettings: ILSPSettings = defaultSettings;

const documentSettings: Map<string, Thenable<ILSPSettings>> = new Map();

connection.onDidChangeConfiguration(change =>
{
  if (hasConfigurationCapability)
  {
    // Reset all cached document settings
    documentSettings.clear();
  }
  else
  {
    globalSettings = <ILSPSettings>((change.settings.languageServerExample || defaultSettings));
  }

  // Revalidate all open text documents
  documents.all().forEach(validateTextDocument);
});

function getDocumentSettings(resource: string): Thenable<ILSPSettings>
{
  if (!hasConfigurationCapability)
  {
    return Promise.resolve(globalSettings);
  }

  let result = documentSettings.get(resource);
  if (!result)
  {
    result = connection.workspace.getConfiguration({
      scopeUri: resource,
      section: 'lsp'
    });
    documentSettings.set(resource, result);
  }
  return result;
}

// Only keep settings for open documents
documents.onDidClose(async e =>
{
  documentSettings.delete(e.document.uri);

  const settings = await getDocumentSettings(e.document.uri);
  if (settings.enabledSyntaxDiagnostic === true)
  {
    const diagnostics: Diagnostic[] = [];
    // Limpar os diagnósticos existentes
    connection.sendDiagnostics({ uri: e.document.uri, diagnostics });

    return;
  }
});

documents.onDidOpen(evt =>
{
  LSPContext.registerClasses(evt.document.uri, LSPParser.parseFile(evt.document.uri, evt.document.getText()));
  validateTextDocument(evt.document);
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(change =>
{
  LSPContext.registerClasses(change.document.uri, LSPParser.parseFile(change.document.uri, change.document.getText()));
  validateTextDocument(change.document);
});

async function validateTextDocument(textDocument: TextDocument): Promise<void>
{
  // In this simple example we get the settings for every validate run.
  const settings = await getDocumentSettings(textDocument.uri);
  const diagnostics: Diagnostic[] = [];

  if (settings.enabledSyntaxDiagnostic === false)
  {
    // Limpar os diagnósticos existentes
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });

    return;
  }

  const text = textDocument.getText();
  const tokens = parserContent(text);
  diagnostics.push(...checkSintaxe(settings.maxNumberOfProblems, tokens));

  // Send the computed diagnostics to VSCode.
  connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

connection.onDidChangeWatchedFiles(_change =>
{
  // Monitored files have change in VSCode
  connection.console.log('We received an file change event');
});

connection.onHover(
  async ({ textDocument: { uri }, position }) =>
  {
    return await LSPContext.getHoverInfo(position, documents.get(uri));
  }
);

// This handler provides the initial list of the completion items.
connection.onCompletion(
  async (docPos: TextDocumentPositionParams, token): Promise<CompletionItem[]> =>
  {
    return await LSPContext.getCompletions(docPos, token, documents.get(docPos.textDocument.uri));
  }
);

connection.onCompletionResolve(
  (item) =>
  {
    return item;
  }
);

connection.onSignatureHelp(
  async (docPos, token) =>
  {
    return await LSPContext.getSignatureHelp(docPos, token, documents.get(docPos.textDocument.uri));
  }
);

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
