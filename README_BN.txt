TUMPA PHOTOGRAPHY — Google Sheets ছাড়া Online Song Selection

এই প্যাকেজে ক্লায়েন্ট ফর্ম, Admin Panel এবং Netlify Function আছে। তথ্য Netlify Blobs অনলাইন স্টোরেজে থাকবে; Google Sheets বা Apps Script লাগবে না। ক্লায়েন্ট মোবাইল থেকে জমা দিলে একই Netlify সাইটের Admin Panel থেকে অন্য ডিভাইসেও দেখা যাবে।

গুরুত্বপূর্ণ: শুধু HTML ফাইল খুললে database কাজ করবে না। Netlify-তে deploy করতে হবে, কারণ server function-টি সেখানেই চলে।

DEPLOY STEPS
1. ZIP extract করুন। ফোল্ডারের ভেতরে index.html, admin.html, netlify.toml, package.json এবং netlify/functions/api.mjs আছে কিনা দেখুন।
2. Netlify-তে এই project deploy করুন। সবচেয়ে নির্ভরযোগ্য পদ্ধতি: GitHub-এ ফোল্ডার upload করে Netlify → Add new site → Import an existing project থেকে repo connect করুন। Build command ফাঁকা রাখুন, Publish directory হিসেবে . রাখুন। Netlify Functions folder netlify/functions স্বয়ংক্রিয়ভাবে detect করবে। package.json-এর dependency install হতে দিন।
3. Netlify Dashboard → Site configuration / Environment variables (বা Environment variables) খুলুন এবং এই তিনটি variable যোগ করুন:
   ADMIN_USERNAME = নিজের পছন্দের admin username
   ADMIN_PASSWORD = লম্বা ও শক্তিশালী নতুন password
   SESSION_SECRET = কমপক্ষে 32 অক্ষরের এলোমেলো গোপন string
   কোনো password আমাকে বা অন্য কাউকে পাঠাবেন না।
4. Environment variables save করার পর নতুন deploy করুন (Deploys → Trigger deploy → Deploy site)।
5. ক্লায়েন্টের লিংক: https://আপনার-সাইট.netlify.app/ অথবা /wedding-song-selection.html
6. Admin Panel: https://আপনার-সাইট.netlify.app/admin.html
7. প্রথমে নিজে একটি test submission দিন, তারপর admin login করে দেখুন।

যদি drag-and-drop deploy-এ function/dependency ঠিকমতো না চলে, GitHub import পদ্ধতি ব্যবহার করুন। এই সংস্করণে পুরনো Apps Script URL/Google Sheet ব্যবহার করা হয় না।

SECURITY NOTES
- Admin username/password কখনো HTML ফাইলে লেখা নেই; Netlify environment variables-এ রাখতে হবে।
- Admin session cookie HttpOnly এবং 8 ঘণ্টা পরে শেষ হবে।
- তথ্য Netlify Blobs-এ রাখা হবে; এটি static HTML-এর localStorage নয়।
- নিজের production ব্যবহারের আগে test submission ও admin login যাচাই করুন।
