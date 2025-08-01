const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
require('dotenv').config();

// התקן את הספרייה הזו: npm install docx-pdf
const docxConverter = require('docx-pdf');

const app = express();
const PORT = 5000;

app.use(cors({ origin: 'http://localhost:3000' }));
app.use(express.json({ limit: '10mb' }));

const UPLOAD_FOLDER = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_FOLDER)) fs.mkdirSync(UPLOAD_FOLDER);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_FOLDER),
  filename: (req, file, cb) => {
    const fileId = uuidv4();
    const ext = path.extname(file.originalname);
    cb(null, fileId + ext);
  },
});
const upload = multer({ storage });

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'לא התקבל קובץ' });
  const fileId = path.parse(req.file.filename).name;
  const shareLink = `http://localhost:3000/sign/${fileId}`;
  res.json({ message: 'הקובץ התקבל', shareLink });
});

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // שימוש ב-TLS רגיל ולא ב-SSL
  auth: {
    user: process.env.EMAIL_ADDRESS,
    pass: process.env.EMAIL_PASSWORD,
  },
  tls: {
    rejectUnauthorized: false
  }
});

transporter.on('error', err => {
  console.error('Nodemailer Error:', err);
});

app.post('/sign/:fileId', async (req, res) => {
  const { fileId } = req.params;
  const { signerName, signatureImage } = req.body;

  if (!signerName) return res.status(400).json({ error: 'חסר שם חתימה' });
  if (!signatureImage) return res.status(400).json({ error: 'חסר חתימה' });

  try {
    const files = fs.readdirSync(UPLOAD_FOLDER);
    const wordFile = files.find(f => path.parse(f).name === fileId && (f.endsWith('.doc') || f.endsWith('.docx')));
    if (!wordFile) return res.status(404).json({ error: 'קובץ לא נמצא' });

    const wordPath = path.join(UPLOAD_FOLDER, wordFile);
    const pdfPath = path.join(UPLOAD_FOLDER, `${fileId}.pdf`);

    // המרת קובץ Word ל-PDF באמצעות הספרייה docx-pdf
    docxConverter(wordPath, pdfPath, async (err, result) => {
      if (err) {
        console.error('שגיאה בהמרת קובץ:', err);
        return res.status(500).json({ error: 'שגיאה בהמרת קובץ' });
      }

      try {
        const pdfBytes = fs.readFileSync(pdfPath);
        const pdfDoc = await PDFDocument.load(pdfBytes);
        pdfDoc.registerFontkit(fontkit);

        const fontBytes = fs.readFileSync(path.join(__dirname, 'fonts', 'Alef-Regular.ttf'));
        const customFont = await pdfDoc.embedFont(fontBytes);

        const pages = pdfDoc.getPages();
        const firstPage = pages[0];

        const today = new Date();
        const dateStr = today.toLocaleDateString('he-IL');

        firstPage.drawText(`חתום על ידי: ${signerName} בתאריך: ${dateStr}`, {
          x: 50,
          y: 100,
          size: 14,
          font: customFont,
          color: rgb(0, 0, 0),
        });

        const base64Data = signatureImage.replace(/^data:image\/png;base64,/, "");
        const signatureImageBytes = Buffer.from(base64Data, 'base64');
        const pngImage = await pdfDoc.embedPng(signatureImageBytes);
        const pngDims = pngImage.scale(0.5);

        firstPage.drawImage(pngImage, {
          x: 50,
          y: 150,
          width: pngDims.width,
          height: pngDims.height,
        });

        const signedPdfBytes = await pdfDoc.save();
        fs.writeFileSync(pdfPath, signedPdfBytes);

        const mailOptions = {
          from: process.env.EMAIL_ADDRESS,
          to: process.env.EMAIL_ADDRESS,
          subject: `המסמך נחתם על ידי: ${signerName}`,
          text: `המסמך נחתם על ידי ${signerName}. ראה קובץ מצורף.`,
          attachments: [{ filename: `${fileId}.pdf`, path: pdfPath }],
        };

        await transporter.sendMail(mailOptions);

        res.json({ message: `המסמך נחתם ונשלח בהצלחה על ידי ${signerName}` });
      } catch (error) {
        console.error('שגיאה בתהליך החתימה:', error);
        res.status(500).json({ error: 'שגיאה בתהליך החתימה: ' + error.message });
      }
    });
  } catch (error) {
    console.error('שגיאה בתהליך החתימה:', error);
    res.status(500).json({ error: 'שגיאה בתהליך החתימה: ' + error.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ השרת רץ על http://localhost:${PORT}`);
});