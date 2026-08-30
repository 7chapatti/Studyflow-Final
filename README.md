This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

This project is an AI assisted assignment planning website.

##Features
User can add assignments via uploading files or by typing a brief which is then analysed by an AI and broken down into sub tasks with time estimations and breakdown then added to a calendar once the user confirms. 
User can add blocked times (times they will not be available). These times are ignored when auto adjusting the calendar.
Calendar is made up of draggable blocks so blocked times and tasks can be shuffled around after clicking the edit button.
Free tier and paid tiers, benefits are listed when clicking upgrade. 
## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.
