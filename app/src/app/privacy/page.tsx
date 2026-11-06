import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy / Privacidade | DM Automation" };

const contact = process.env.NEXT_PUBLIC_PRIVACY_CONTACT;

const Block = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="space-y-2">
    <h2 className="text-lg font-semibold">{title}</h2>
    {children}
  </section>
);

/** Draft written from what the tool really does. It must be reviewed by TR Legal before it is used as the official policy. */
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-8 px-4 py-10 text-sm leading-relaxed text-text">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">Privacy notice</h1>
        <p className="text-text-muted">DM Automation, an internal Thomson Reuters Marketing tool. Draft pending review by TR Legal.</p>
      </header>

      <Block title="What this tool does">
        <p>It answers comments and direct messages that people send to our Instagram and Facebook Page accounts (for example, sending a document when someone comments a keyword), and lets our team follow those conversations.</p>
      </Block>
      <Block title="What we receive and store">
        <ul className="list-disc space-y-1 pl-5">
          <li>Your account identifier on Instagram or Messenger and, when Meta provides it, your username or name.</li>
          <li>The comment or message you sent us, the post it was on, and the time.</li>
          <li>Whether you tapped a button in our reply, and which tags we added (for example, the topic you asked about).</li>
          <li>Your language, when Meta provides it, to answer in the right language.</li>
        </ul>
        <p>We do not receive your password. We do not collect payment data.</p>
      </Block>
      <Block title="Why">
        <p>To reply to what you asked for, to avoid sending you the same message twice, to respect your request to stop, and to measure whether our content is useful.</p>
      </Block>
      <Block title="Stopping messages">
        <p>Send STOP (or PARAR, BAJA) in the conversation and automated messages stop. Send START to receive them again.</p>
      </Block>
      <Block title="Who can see it">
        <p>The Thomson Reuters Marketing team members who were given access to this tool. It is hosted on Vercel and stored in Supabase; Meta delivers the messages. We do not sell this data.</p>
      </Block>
      <Block title="Deleting your data">
        <p>
          See the <a className="text-accent underline" href="/data-deletion">data deletion page</a>.
        </p>
      </Block>
      <Block title="Contact">
        <p>{contact ? <a className="text-accent underline" href={`mailto:${contact}`}>{contact}</a> : "Ask the person who manages the Thomson Reuters Instagram or Facebook account you wrote to."}</p>
      </Block>

      <hr className="border-border" />

      <header className="space-y-2">
        <h1 className="text-2xl font-bold">Aviso de privacidade</h1>
        <p className="text-text-muted">DM Automation, ferramenta interna do Marketing da Thomson Reuters. Rascunho, pendente de revisão do Jurídico da TR.</p>
      </header>
      <Block title="O que a ferramenta faz">
        <p>Responde a comentários e mensagens diretas enviados às nossas contas de Instagram e Página do Facebook (por exemplo, enviar um documento quando alguém comenta uma palavra) e permite que nossa equipe acompanhe as conversas.</p>
      </Block>
      <Block title="O que recebemos e guardamos">
        <ul className="list-disc space-y-1 pl-5">
          <li>O identificador da sua conta no Instagram ou Messenger e, quando a Meta informa, seu nome de usuário ou nome.</li>
          <li>O comentário ou a mensagem que você enviou, a publicação em que estava e o horário.</li>
          <li>Se você tocou em um botão da nossa resposta e quais etiquetas aplicamos (por exemplo, o tema do seu interesse).</li>
          <li>Seu idioma, quando a Meta informa, para responder no idioma certo.</li>
        </ul>
        <p>Não recebemos sua senha nem coletamos dados de pagamento.</p>
      </Block>
      <Block title="Para quê">
        <p>Para responder ao que você pediu, evitar enviar a mesma mensagem duas vezes, respeitar o seu pedido para parar e medir se o conteúdo é útil.</p>
      </Block>
      <Block title="Parar as mensagens">
        <p>Envie PARAR (ou STOP, BAJA) na conversa e as mensagens automáticas cessam. Envie INICIAR para voltar a recebê-las.</p>
      </Block>
      <Block title="Quem pode ver">
        <p>Os integrantes do Marketing da Thomson Reuters que receberam acesso à ferramenta. Ela roda na Vercel e os dados ficam no Supabase; a Meta entrega as mensagens. Não vendemos esses dados.</p>
      </Block>
      <Block title="Excluir seus dados">
        <p>
          Veja a <a className="text-accent underline" href="/data-deletion">página de exclusão de dados</a>.
        </p>
      </Block>
    </main>
  );
}
