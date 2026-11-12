/*! B.N.B — Language system (বাংলা / English)
 *
 * How it works
 * ------------
 * The site is authored in Bangla. This module adds a professional, reversible
 * English layer on top of it without touching the Bangla source text:
 *
 *   1. DICT      – exact Bangla → English phrases (UI, forms, toasts, defaults).
 *   2. PATTERNS  – sentences that embed live data (names, numbers, dates, hospitals).
 *   3. A DOM translator walks text nodes + a11y attributes (placeholder, aria-label,
 *      title, alt) and a MutationObserver translates anything the app renders later
 *      (Firebase data, pagination, toasts, modals).
 *   4. The original Bangla is remembered per node, so switching back is lossless.
 *
 * Content typed by admins (donor names, news posts, hospital names …) is never
 * machine-translated; it is shown exactly as entered.
 *
 * Public API:  window.I18N = { lang, set(lang), t(bnString), fmtDate(date, style), onChange(fn) }
 * Persistence: localStorage "bnb_lang"  ·  URL override: ?lang=en | ?lang=bn
 */
(function (global) {
  "use strict";

  var STORAGE_KEY = "bnb_lang";
  var SUPPORTED = ["bn", "en"];
  var DEFAULT_LANG = "bn";
  var ATTRS = ["placeholder", "aria-label", "title", "alt"];
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, NOSCRIPT: 1, CODE: 1 };
  var BN_ANY = /[\u0980-\u09FF]/;
  var BN_LETTER = /[\u0980-\u09E5\u09F0-\u09FF]/; // Bengali letters, excluding digits ০-৯
  var EN_DIGITS = "0123456789";
  var BN_DIGITS = "০১২৩৪৫৬৭৮৯";

  /* ------------------------------------------------------------------ */
  /*  1. Dictionary (Bangla → English)                                   */
  /* ------------------------------------------------------------------ */
  var PAIRS = [
    /* ---- navigation ---- */
    ["হোম", "Home"],
    ["কীভাবে কাজ করে", "How It Works"],
    ["রক্তের গ্রুপ চার্ট", "Blood Group Chart"],
    ["রক্তদান রেকর্ড", "Donation Records"],
    ["সংবাদ", "News"],
    ["হাসপাতাল", "Hospitals"],
    ["যোগ দিন", "Join Us"],
    ["রক্তদাতা হিসেবে যোগ দিন", "Join as a Blood Donor"],
    ["মেনু খুলুন", "Open menu"],
    ["মেনু বন্ধ করুন", "Close menu"],
    ["হোমে ফিরে যান", "Back to home"],
    ["পেজ নেভিগেশন", "Page navigation"],
    ["উপরে ফিরে যান", "Back to top"],

    /* ---- hero ---- */
    ["প্রতিটি ফোঁটা রক্ত, একটি নতুন জীবনের গল্প", "Every drop of blood is the story of a new life"],
    ["জরুরি মুহূর্তে নির্ভরযোগ্য রক্তদাতা খুঁজে পাওয়ার সবচেয়ে সহজ উপায়। বিনামূল্যে ও স্বেচ্ছাসেবী রক্তদাতাদের নেটওয়ার্কে আজই যুক্ত হোন, জীবন বাঁচাতে হাত বাড়ান।",
      "The easiest way to find a reliable blood donor in an emergency. Join our free, volunteer donor network today and lend a hand to save a life."],
    ["জরুরি রক্তের প্রয়োজন? অনুরোধ পাঠান", "Need blood urgently? Send a request"],
    ["নাম ১", "Name 1"], ["নাম ২", "Name 2"], ["নাম ৩", "Name 3"], ["নাম", "Name"],
    ["ID, নাম বা হাসপাতাল দিয়ে খুঁজুন...", "Search by ID, name or hospital..."],
    ["নাম, ID বা হাসপাতাল দিয়ে খুঁজুন...", "Search by name, ID or hospital..."],
    ["ID, নাম বা হাসপাতালের নাম লিখুন", "Enter an ID, name or hospital name"],
    ["খুঁজুন", "Search"],

    /* ---- stats ---- */
    ["মোট রক্তদাতা", "Total Donors"],
    ["মোট রক্তদান", "Total Donations"],
    ["গত ২৮ দিনে রক্তদান", "Donations in the Last 28 Days"],
    ["মোট ভিজিটর", "Total Visitors"],
    ["সাম্প্রতিক রক্তদাতা", "Recent Donors"],
    ["সাম্প্রতিক রক্তদান", "Recent Donations"],
    ["আজকের হিরো", "Today's Hero"],
    ["রক্তদাতা তালিকা", "Donor List"],
    ["রক্তের গ্রুপ ফিল্টার", "Blood group filter"],
    ["সব গ্রুপ", "All groups"],

    /* ---- gallery ---- */
    ["সব ছবি দেখুন", "View all photos"],
    ["সব ছবি", "All photos"],
    ["সব রক্তদানের ছবি", "All donation photos"],
    ["রক্তদানের ছবি", "Donation photo"],
    ["রিপোর্টের ছবি", "Report photo"],
    ["ছবি মুছুন", "Remove photo"],
    ["এখনও কোনো ছবি যোগ করা হয়নি", "No photos have been added yet"],
    ["(ছবিতে চাপ দিয়ে বড় করে দেখুন)", "(Tap a photo to enlarge)"],
    ["বড় করে দেখুন", "View larger"],
    ["আগের", "Previous"],
    ["পরের", "Next"],
    ["আগের পেজ", "Previous page"],
    ["পরের পেজ", "Next page"],

    /* ---- about ---- */
    ["আমাদের সম্পর্কে", "About Us"],
    ["আমরা কারা", "Who We Are"],
    ["Blood Network Baraikhali একটি স্বেচ্ছাসেবী রক্তদাতা প্ল্যাটফর্ম, যেখানে যাচাইকৃত রক্তদাতাদের তথ্য একত্রে রাখা হয় যাতে জরুরি প্রয়োজনে দ্রুত সঠিক রক্তদাতার সাথে যোগাযোগ করা যায়। আমাদের লক্ষ্য — প্রতিটি এলাকায় যেন রক্তের অভাবে কোনো জীবন ঝুঁকিতে না পড়ে।",
      "Blood Network Baraikhali is a volunteer blood donor platform that keeps the details of verified donors in one place, so the right donor can be reached quickly in an emergency. Our goal is that no life in any community is put at risk for lack of blood."],
    ["আমরা যা নিশ্চিত করি", "What We Ensure"],
    ["কেন আমরা", "Why Choose Us"],
    ["যাচাইকৃত রক্তদাতা", "Verified Donors"],
    ["প্রতিটি রক্তদাতার তথ্য যাচাই করে তালিকাভুক্ত করা হয়, যাতে জরুরি সময়ে নির্ভরযোগ্য যোগাযোগ নিশ্চিত হয়।",
      "Every donor's details are verified before being listed, so you can reach someone reliable in an emergency."],
    ["সম্পূর্ণ বিনামূল্যে", "Completely Free"],
    ["কোনো সাইনআপ ফি বা লুকানো খরচ নেই — যে কেউ রক্তদাতা হতে বা খুঁজতে পারেন সম্পূর্ণ বিনামূল্যে।",
      "There is no signup fee or hidden cost — anyone can become a donor or search for one, completely free of charge."],
    ["জরুরি সাড়া", "Emergency Response"],
    ["২৪/৭ সাড়া", "24/7 Response"],
    ["স্বেচ্ছাসেবী রক্তদাতাদের একটি বিশ্বস্ত নেটওয়ার্ক — জরুরি প্রয়োজনে জীবন বাঁচাতে পাশে আছি।",
      "A trusted network of volunteer blood donors — standing by your side to save lives in an emergency."],

    /* ---- team ---- */
    ["আমাদের টিম", "Our Team"],
    ["যাদের নিয়ে আমরা", "The People Behind Us"],
    ["স্বেচ্ছাসেবার মানসিকতা নিয়ে যারা প্রতিদিন জীবন বাঁচাতে কাজ করছেন", "Volunteers who work every day to save lives, driven by a spirit of service"],
    ["টিম সদস্যের তথ্য", "Team member details"],
    ["এখনও কোনো টিম সদস্য যোগ করা হয়নি — এডিট মোডে যোগ করুন", "No team members have been added yet — add them in edit mode"],
    ["আমাদের যাত্রা", "Our Journey"],

    /* ---- how it works ---- */
    ["রক্ত প্রয়োজন হলে", "If You Need Blood"],
    ["রক্তদাতা হতে চাইলে", "If You Want to Donate"],
    ["এখনও কোনো ধাপ যোগ করা হয়নি — এডিট মোডে যোগ করুন", "No steps have been added yet — add them in edit mode"],
    ["রক্তের গ্রুপ ও এলাকা লিখে সার্চ করুন", "Search by blood group and area"],
    ["ওয়েবসাইটে গিয়ে প্রয়োজনীয় রক্তের গ্রুপ এবং আপনার এলাকা নির্বাচন করুন — কোনো সাইনআপ ছাড়াই।",
      "Visit the website and select the blood group you need and your area — no signup required."],
    ["তালিকা থেকে রক্তদাতা বাছাই করুন", "Choose a donor from the list"],
    ["যাচাইকৃত ও সক্রিয় রক্তদাতাদের একটি তালিকা মুহূর্তেই দেখতে পাবেন।", "See a list of verified, active donors instantly."],
    ["ব্লাড গ্রুপ ও এলাকা অনুযায়ী মুহূর্তেই কাছাকাছি রক্তদাতা খুঁজে বের করা যায়, একদম ফ্রি-তে।",
      "Find nearby donors by blood group and area in moments — absolutely free."],
    ["সরাসরি কল করুন", "Call directly"],
    ["তালিকায় দেওয়া নাম্বারে সরাসরি ফোন করে যোগাযোগ করুন — মাঝে কোনো মধ্যস্থতাকারী নেই।",
      "Phone the number in the list directly — there are no middlemen."],
    ["সময় ও স্থান ঠিক করুন", "Fix a time and place"],
    ["রক্তদাতার সাথে কথা বলে সুবিধাজনক সময় ও হাসপাতাল/স্থান ঠিক করে নিন।",
      "Talk with the donor and agree on a convenient time and hospital or location."],
    ["রক্ত সংগ্রহ করুন, জীবন বাঁচান", "Receive Blood, Save a Life"],
    ["নির্ধারিত সময়ে রক্তদাতা এসে রক্ত দেন — এবং একটি জীবন বেঁচে যায়।",
      "The donor arrives at the agreed time and donates blood — and a life is saved."],
    ["নিবন্ধন করুন", "Register"],
    ["নাম, রক্তের গ্রুপ, ফোন নাম্বার ও এলাকা দিয়ে নেটওয়ার্কে যুক্ত হোন — সম্পূর্ণ বিনামূল্যে।",
      "Join the network with your name, blood group, phone number and area — completely free."],
    ["প্রোফাইল যাচাই হয়", "Your profile is verified"],
    ["আমাদের টিম আপনার তথ্য যাচাই করে রক্তদাতার তালিকায় যুক্ত করে দেবে।",
      "Our team will verify your details and add you to the donor list."],
    ["প্রয়োজনে কল পাবেন", "Get a call when needed"],
    ["কারো রক্তের প্রয়োজন হলে এবং আপনার গ্রুপ মিললে সরাসরি ফোন কল পাবেন।",
      "When someone needs blood and your group matches, you will receive a direct phone call."],
    ["স্বেচ্ছায় সিদ্ধান্ত নিন", "Decide voluntarily"],
    ["আপনার সুবিধা ও শারীরিক সুস্থতা বিবেচনা করে রক্ত দেওয়ার সিদ্ধান্ত সম্পূর্ণ আপনার নিজের।",
      "Whether to donate is entirely your own decision, based on your convenience and health."],
    ["সহজ ও বিনামূল্যে", "Simple and Free"],
    ["কল করে যোগ দিন", "Join by Calling"],
    ["রক্তদাতা হিসেবে নিবন্ধন করতে নিচের যেকোনো নম্বরে সরাসরি কল করুন।",
      "To register as a blood donor, call any of the numbers below directly."],
    ["এর পরিবর্তে সরাসরি কল করতে চান?", "Prefer to call directly instead?"],

    /* ---- blood group chart ---- */
    ["দাতা \\ গ্রহীতা", "Donor \\ Recipient"],
    ["সারি = দাতার গ্রুপ, কলাম = গ্রহীতার গ্রুপ। ✓ চিহ্ন মানে সেই দাতা ঐ গ্রহীতাকে রক্ত দিতে পারবেন।",
      "Rows = donor group, columns = recipient group. A ✓ means that donor can give blood to that recipient."],
    ["একটি রক্তদান একাধিক মানুষের জীবন বাঁচাতে সাহায্য করতে পারে।", "A single blood donation can help save more than one life."],

    /* ---- donation records & search ---- */
    ["সকল রক্তদান রেকর্ড", "All Donation Records"],
    ["ডোনেশন রেকর্ড", "Donation Records"],
    ["ডোনেশন হিস্ট্রি রিপোর্ট", "Donation History Report"],
    ["এখনও কোনো রেকর্ড যোগ করা হয়নি", "No records have been added yet"],
    ["এই খোঁজে কোনো রেকর্ড পাওয়া যায়নি", "No records found for this search"],
    ["কোনো রেকর্ড পাওয়া যায়নি", "No records found"],
    ["এই ID-তে কোনো রেকর্ড পাওয়া যায়নি। ID আবার যাচাই করুন।", "No record was found for this ID. Please check the ID and try again."],
    ["ডোনার ছবি প্রকাশ করতে ইচ্ছুক নয়", "Donor prefers not to show a photo"],
    ["QR কোড — কার্ড লিংক", "QR code — card link"],
    ["স্ক্যান করে কার্ড দেখুন", "Scan to view the card"],
    ["রক্ত দিন • জীবন বাঁচান", "Donate Blood • Save Lives"],
    ["❤️ রক্ত দিন • জীবন বাঁচান", "❤️ Donate Blood • Save Lives"],
    ["🌍 মানবতার সেবায় আমরা একসাথে", "🌍 Together in the service of humanity"],
    ["ভাই/বোনের জন্য সবাই দোয়া করবেন।", "Please keep our brother/sister in your prayers."],
    ["ভাই", "Brother"],
    ["বোন", "Sister"],
    ["ব্লাড নেটওয়ার্ক", "Blood Network"],
    ["ডাউনলোড করুন", "Download"],
    ["লিংক কপি", "Copy link"],
    ["শেয়ার", "Share"],
    ["প্রস্তুত হচ্ছে...", "Preparing..."],
    ["ওপেন করুন", "Open"],
    ["ওয়েবসাইট দেখুন", "Visit website"],
    ["লিংক", "Link"],
    ["ফেসবুক", "Facebook"],
    ["হোয়াটসঅ্যাপ", "WhatsApp"],
    ["মেসেঞ্জার", "Messenger"],

    /* ---- news ---- */
    ["সংবাদ ও আপডেট", "News & Updates"],
    ["সংবাদ লোড হচ্ছে…", "Loading news…"],
    ["এখনও কোনো সংবাদ প্রকাশ করা হয়নি — এডমিন প্যানেল থেকে যোগ করুন", "No news has been published yet — add some from the admin panel"],
    ["এখনও কোনো সংবাদ প্রকাশ করা হয়নি।", "No news has been published yet."],
    ["এই সংবাদটি খুঁজে পাওয়া যায়নি — এটি সরিয়ে ফেলা হয়ে থাকতে পারে।", "This news post could not be found — it may have been removed."],
    ["সংবাদ তালিকায় ফিরে যান", "Back to news list"],
    ["সংবাদ লোড করা যায়নি — ইন্টারনেট সংযোগ পরীক্ষা করে পেজটি রিফ্রেশ করুন।", "Couldn't load the news — check your internet connection and refresh the page."],
    ["শিরোনামহীন", "Untitled"],
    ["লাইক", "Like"],
    ["লাইক দিন", "Like"],
    ["লাইক সরান", "Remove like"],

    /* ---- hospitals / sponsors / partners / FAQ ---- */
    ["হাসপাতাল ও ব্লাড ব্যাংক", "Hospitals & Blood Banks"],
    ["এখনও কোনো হাসপাতাল/ব্লাড ব্যাংক যোগ করা হয়নি — এডমিন প্যানেল থেকে যোগ করুন", "No hospitals or blood banks have been added yet — add them from the admin panel"],
    ["ব্লাড ব্যাংক", "Blood Bank"],
    ["কল করুন", "Call"],
    ["আমাদের স্পনসর", "Our Sponsors"],
    ["স্পনসর", "Sponsors"],
    ["প্রধান স্পনসর", "Principal Sponsor"],
    ["গোল্ড স্পনসর", "Gold Sponsor"],
    ["সিলভার স্পনসর", "Silver Sponsor"],
    ["সহায়ক স্পনসর", "Supporting Sponsor"],
    ["স্পনসর করছেন", "Sponsored by"],
    ["সহযোগী", "Partners"],
    ["আমাদের সহযোগী প্রতিষ্ঠান", "Our Partner Organizations"],
    ["যাদের সহযোগিতায় আমরা মানুষের পাশে দাঁড়াতে পারছি", "With whose support we are able to stand by people in need"],
    ["এখনও কোনো সহযোগী যোগ করা হয়নি — এডিট মোডে যোগ করুন", "No partners have been added yet — add them in edit mode"],
    ["সহযোগী মুছুন", "Remove partner"],
    ["প্রশ্ন ও উত্তর", "Questions & Answers"],
    ["সচরাচর জিজ্ঞাসা", "Frequently Asked Questions"],
    ["এখনও কোনো প্রশ্ন যোগ করা হয়নি — এডিট মোডে যোগ করুন", "No questions have been added yet — add them in edit mode"],
    ["প্রশ্ন মুছুন", "Remove question"],
    ["ধাপ মুছুন", "Remove step"],

    /* ---- call-to-action band & footer ---- */
    ["আজই একজন রক্তদাতা হয়ে অন্য কারো জীবনে আশার আলো হয়ে উঠুন", "Become a donor today and be a ray of hope in someone else's life"],
    ["রক্তদান করুন, বদলে দিন একটি জীবন", "Donate blood, change a life"],
    ["যোগাযোগ", "Contact"],
    ["অন্যান্য", "Other"],
    ["সর্বস্বত্ব সংরক্ষিত (All Rights Reserved)", "All Rights Reserved"],

    /* ---- calling card ---- */
    ["রক্তের প্রয়োজনে কল করুন", "Call for blood"],
    ["যাচাইকৃত", "Verified"],
    ["সক্রিয়", "Active"],
    ["বন্ধ করুন", "Close"],

    /* ---- forms ---- */
    ["জরুরি রক্তের অনুরোধ", "Urgent Blood Request"],
    ["নিচের তথ্যগুলো পূরণ করে পাঠান। আপনার অনুরোধ সরাসরি এডমিনের কাছে চলে যাবে, তারা দ্রুত যোগাযোগ করবে।",
      "Fill in the details below and submit. Your request goes directly to the admin team, who will contact you quickly."],
    ["নিচের তথ্যগুলো পূরণ করে পাঠান। আমাদের এডমিন টিম যাচাই করে আপনার রিকোয়েস্ট অনুমোদন করবে।",
      "Fill in the details below and submit. Our admin team will review and approve your request."],
    ["অনুরোধ পাঠান", "Send Request"],
    ["রিকোয়েস্ট পাঠান", "Submit Request"],
    ["বাতিল", "Cancel"],
    ["রোগীর নাম *", "Patient's Name *"],
    ["প্রয়োজনীয় রক্তের গ্রুপ *", "Required Blood Group *"],
    ["কতব্যাগ প্রয়োজন", "Bags of Blood Needed"],
    ["হাসপাতাল / স্থান *", "Hospital / Location *"],
    ["যোগাযোগের নাম্বার *", "Contact Number *"],
    ["রোগীর সমস্যা", "Patient's Condition"],
    ["বিস্তারিত (ঐচ্ছিক)", "Details (optional)"],
    ["পূর্ণ নাম *", "Full Name *"],
    ["জেন্ডার *", "Gender *"],
    ["পুরুষ", "Male"],
    ["নারী", "Female"],
    ["বয়স *", "Age *"],
    ["রক্তের গ্রুপ *", "Blood Group *"],
    ["মোবাইল নাম্বার *", "Mobile Number *"],
    ["ঠিকানা *", "Address *"],
    ["হিমোগ্লোবিনের পরিমাণ (g/dL)", "Hemoglobin level (g/dL)"],
    ["-- নির্বাচন করুন --", "-- Select --"],
    ["ঢাকা, বাংলাদেশ", "Dhaka, Bangladesh"],
    ["যেমন: 25", "e.g. 25"],
    ["যেমন: ১", "e.g. 1"],
    ["যেমন: ৭.৫", "e.g. 7.5"],
    ["যেমন: Baraikhali, ...", "e.g. Baraikhali, ..."],
    ["যেমন: karim miya", "e.g. karim miya"],
    ["যেমন: অপারেশনের জন্য রক্তের প্রয়োজন", "e.g. Blood needed for an operation"],
    ["যেমন: আজ রাতের মধ্যে প্রয়োজন", "e.g. Needed by tonight"],
    ["যেমন: ঢাকা মেডিকেল কলেজ হাসপাতাল", "e.g. Dhaka Medical College Hospital"],
    ["পাঠানো হচ্ছে...", "Sending..."],

    /* ---- toasts & messages ---- */
    ["লিংক কপি করা হয়েছে", "Link copied"],
    ["লাইক সেভ করা যায়নি, আবার চেষ্টা করুন", "Couldn't save your like. Please try again."],
    ["অনুগ্রহ করে সবগুলো ঘর পূরণ করুন", "Please fill in all the fields"],
    ["অনুগ্রহ করে আবশ্যক ঘরগুলো পূরণ করুন", "Please fill in the required fields"],
    ["রক্তদাতার বয়স কমপক্ষে ১৮ বছর হতে হবে", "A donor must be at least 18 years old"],
    ["ইন্টারনেট সংযোগ পাওয়া যায়নি, একটু পর আবার চেষ্টা করুন", "No internet connection. Please try again in a moment."],
    ["আপনার রিকোয়েস্ট পাঠানো হয়েছে, এডমিন যাচাই করে অনুমোদন দেবে", "Your request has been submitted. The admin will review and approve it."],
    ["রিকোয়েস্ট পাঠানো যায়নি, আবার চেষ্টা করুন", "Couldn't submit your request. Please try again."],
    ["আপনার জরুরি অনুরোধ পাঠানো হয়েছে, এডমিন দ্রুত যোগাযোগ করবে", "Your urgent request has been sent. The admin will contact you shortly."],
    ["অনুরোধ পাঠানো যায়নি, আবার চেষ্টা করুন", "Couldn't send your request. Please try again."],
    ["পপ-আপ ব্লক হয়েছে, ব্রাউজারে অনুমতি দিন", "Pop-up blocked. Please allow pop-ups in your browser."],
    ["নতুন উইন্ডোতে কার্ড প্রস্তুত", "Card ready in a new window"],
    ["প্রিভিউ তৈরি করা যায়নি", "Couldn't create the preview"],
    ["প্রিভিউ তৈরি করা যায়নি, আবার চেষ্টা করুন", "Couldn't create the preview. Please try again."],

    /* ---- gender / misc fragments rendered next to live data ---- */
    ["আমি আছি", "I'm here"],
    ["সাধারণ", "General"],
    ["ডিসেম্বর", "December"],
    ["ডোনার", ""],
    ["বারের মতো", "time donated"],
    ["বার", "time(s)"]
  ];

  var DICT = Object.create(null);
  PAIRS.forEach(function (p) { DICT[p[0]] = p[1]; });

  /* ------------------------------------------------------------------ */
  /*  2. Helpers + patterns for sentences that contain live data         */
  /* ------------------------------------------------------------------ */
  function digitsToEn(s) {
    return String(s).replace(/[০-৯]/g, function (d) { return EN_DIGITS.charAt(BN_DIGITS.indexOf(d)); });
  }

  function enOrdinal(n) {
    var v = n % 100;
    if (v >= 11 && v <= 13) return n + "th";
    switch (n % 10) {
      case 1: return n + "st";
      case 2: return n + "nd";
      case 3: return n + "rd";
      default: return n + "th";
    }
  }

  var WORD_ORD = {
    "প্রথম": "first", "দ্বিতীয়": "second", "তৃতীয়": "third", "চতুর্থ": "fourth", "পঞ্চম": "fifth",
    "ষষ্ঠ": "sixth", "সপ্তম": "seventh", "অষ্টম": "eighth", "নবম": "ninth", "দশম": "tenth",
    "একাদশ": "eleventh", "দ্বাদশ": "twelfth", "ত্রয়োদশ": "thirteenth", "চতুর্দশ": "fourteenth",
    "পঞ্চদশ": "fifteenth", "ষোড়শ": "sixteenth", "সপ্তদশ": "seventeenth", "অষ্টাদশ": "eighteenth",
    "ঊনবিংশ": "nineteenth", "বিংশ": "twentieth"
  };

  /* "৩য়" / "১০ম" / "১১তম"  →  "3rd" / "10th" / "11th"   (digits stay as-is if no ordinal suffix) */
  function shortOrdinal(tok) {
    var m = /^([০-৯]+)(ম|য়|র্থ|ষ্ঠ|তম)$/.exec(tok);
    if (m) return enOrdinal(parseInt(digitsToEn(m[1]), 10));
    return digitsToEn(tok);
  }

  function plural(n, one, many) { return n + " " + (parseInt(n, 10) === 1 ? one : many); }

  var PATTERNS = [
    /* pagination: "পেজ ১ / ৩ · মোট ২৫টি রেকর্ড" */
    [/^পেজ (\S+) \/ (\S+) · মোট (\S+)টি (ছবি|রেকর্ড)$/, function (m) {
      var n = digitsToEn(m[3]);
      return "Page " + digitsToEn(m[1]) + " / " + digitsToEn(m[2]) + " · " + n + " total " + (m[4] === "ছবি" ? (n === "1" ? "photo" : "photos") : (n === "1" ? "record" : "records"));
    }],
    [/^পেজ (\S+)$/, function (m) { return "Page " + digitsToEn(m[1]); }],
    [/^(\S+)টি ছবি$/, function (m) { return plural(digitsToEn(m[1]), "photo", "photos"); }],
    [/^(\S+)টি রেকর্ড$/, function (m) { return plural(digitsToEn(m[1]), "record", "records"); }],
    [/^মোট (\S+)টি মিলেছে — সবগুলো দেখুন$/, function (m) { return digitsToEn(m[1]) + " found — view all"; }],
    [/^রিপোর্ট ছবি (\S+)$/, function (m) { return "Report photo " + digitsToEn(m[1]); }],

    /* donor serial number + visit count */
    [/^(\S+) নাম্বার ডোনার$/, function (m) { return "Donor #" + digitsToEn(m[1]); }],
    [/^(\S+) নাম্বার$/, function (m) { return "Donor #" + digitsToEn(m[1]); }],
    [/^(\S+) বারের মতো$/, function (m) { return shortOrdinal(m[1]) + " time donated"; }],
    [/^(\S+) বার$/, function (m) { return shortOrdinal(m[1]) + " time"; }],
    [/^([০-৯]+(?:ম|য়|র্থ|ষ্ঠ|তম))$/, function (m) { return shortOrdinal(m[1]); }],
    [/^(প্রথম|দ্বিতীয়|তৃতীয়|চতুর্থ|পঞ্চম|ষষ্ঠ|সপ্তম|অষ্টম|নবম|দশম|একাদশ|দ্বাদশ|ত্রয়োদশ|চতুর্দশ|পঞ্চদশ|ষোড়শ|সপ্তদশ|অষ্টাদশ|ঊনবিংশ|বিংশ)বারের মতো$/,
      function (m) { return "for the " + WORD_ORD[m[1]] + " time"; }],
    [/^([০-৯]+)তমবারের মতো$/, function (m) { return "for the " + enOrdinal(parseInt(digitsToEn(m[1]), 10)) + " time"; }],

    /* last donation date (dates themselves are formatted by I18N.fmtDate) */
    [/^সর্বশেষ রক্তদান:\s*(.*)$/, function (m) { return "Last donation: " + digitsToEn(m[1]); }],

    /* "(A+) লাল ভালোবাসা দান করলেন <hospital> এ।" and its DOM-split fragments */
    [/^\((.*)\) লাল ভালোবাসা দান করলেন (.+) এ।$/, function (m) { return "(" + m[1] + ") donated blood at " + m[2] + "."; }],
    [/^\((.*)\) লাল ভালোবাসা দান করলেন$/, function (m) { return "(" + m[1] + ") donated blood at"; }],
    [/^(ভাই|বোন) এর জন্য সবাই দোয়া করবেন।$/, function (m) { return "Please keep our " + (m[1] === "বোন" ? "sister" : "brother") + " in your prayers."; }],
    [/^(.+) এর পক্ষ থেকে অবিরাম ভালোবাসা রইলো।(?: 🤝🖤)?$/, function (m) { return m[1] + " sends you endless love."; }],
    [/^এর পক্ষ থেকে অবিরাম ভালোবাসা রইলো।$/, function () { return "sends you endless love."; }],

    /* like button a11y label */
    [/^(লাইক সরান|লাইক দিন) — মোট (.+)$/, function (m) { return (m[1] === "লাইক সরান" ? "Remove like" : "Like") + " — " + digitsToEn(m[2]) + " total"; }]
  ];

  /* ------------------------------------------------------------------ */
  /*  3. Translation core                                                */
  /* ------------------------------------------------------------------ */
  function translate(raw) {
    if (!raw || !BN_ANY.test(raw)) return raw;
    var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(raw);
    var core = m[2];
    if (!core) return raw;
    var key = core.replace(/\s+/g, " ").replace(/\\+/g, "\\");

    var hit = DICT[key];
    if (hit !== undefined) return m[1] + hit + m[3];

    for (var i = 0; i < PATTERNS.length; i++) {
      var r = PATTERNS[i][0].exec(key);
      if (r) return m[1] + PATTERNS[i][1](r) + m[3];
    }
    // purely numeric text written with Bengali digits (counters, phone numbers…)
    if (!BN_LETTER.test(key)) {
      var d = digitsToEn(key);
      if (d !== key) return m[1] + d + m[3];
    }
    return raw; // unknown / admin-authored content stays exactly as entered
  }

  var MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function fmtDate(d, style) {
    if (!(d instanceof Date) || isNaN(d.getTime())) return "";
    var mon = (style === "long" ? MONTHS_LONG : MONTHS_SHORT)[d.getMonth()];
    return d.getDate() + " " + mon + ", " + d.getFullYear();
  }

  /* ------------------------------------------------------------------ */
  /*  4. State, DOM walker and observer                                  */
  /* ------------------------------------------------------------------ */
  var lang = DEFAULT_LANG;
  var textState = new Map(); // Text node -> { o: original Bangla, s: shown English }
  var attrState = new Map(); // Element   -> { attrName: { o, s } }
  var listeners = [];
  var observer = null;
  var pendingPrune = 0;

  function adminActive() {
    return !!(document.body && document.body.classList.contains("adminMode"));
  }

  function skippable(el) {
    if (!el) return false;
    if (SKIP_TAGS[el.tagName]) return true;
    return !!(el.closest && el.closest('[data-i18n-skip], [contenteditable="true"]'));
  }

  function prune() {
    textState.forEach(function (_, n) { if (!n.isConnected) textState.delete(n); });
    attrState.forEach(function (_, e) { if (!e.isConnected) attrState.delete(e); });
  }

  function xText(n) {
    var cur = n.nodeValue;
    var st = textState.get(n);
    if (st && cur === st.s) return;                // our own write
    if (!cur || !BN_ANY.test(cur)) { if (st) textState.delete(n); return; }
    if (skippable(n.parentElement)) return;
    var out = translate(cur);
    if (out !== cur) {
      textState.set(n, { o: cur, s: out });
      n.nodeValue = out;
      if (++pendingPrune > 4000) { pendingPrune = 0; prune(); }
    } else if (st) {
      textState.delete(n);
    }
  }

  function xAttrs(el) {
    if (skippable(el)) return;
    var bag = attrState.get(el);
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      if (!el.hasAttribute(a)) continue;
      var cur = el.getAttribute(a);
      var st = bag && bag[a];
      if (st && cur === st.s) continue;
      if (!BN_ANY.test(cur)) { if (st) delete bag[a]; continue; }
      var out = translate(cur);
      if (out !== cur) {
        if (!bag) { bag = {}; attrState.set(el, bag); }
        bag[a] = { o: cur, s: out };
        el.setAttribute(a, out);
      }
    }
  }

  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { xText(root); return; }
    if (root.nodeType !== 1) return;
    if (skippable(root)) return;
    xAttrs(root);
    var tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (node.nodeType === 1 && (SKIP_TAGS[node.tagName] || node.hasAttribute("data-i18n-skip"))) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var n;
    while ((n = tw.nextNode())) {
      if (n.nodeType === 3) xText(n); else xAttrs(n);
    }
  }

  function applyMeta() {
    var meta = document.querySelector('meta[name="description"]');
    if (!meta) return;
    if (!meta.hasAttribute("data-bn")) meta.setAttribute("data-bn", meta.getAttribute("content") || "");
    meta.setAttribute("content", lang === "en"
      ? "Blood Network Baraikhali — the easiest way to find a reliable blood donor in an emergency."
      : meta.getAttribute("data-bn"));
  }

  function translateAll() {
    if (!document.body) return;
    walk(document.body);
  }

  function restoreAll() {
    textState.forEach(function (st, n) { if (n.isConnected && n.nodeValue === st.s) n.nodeValue = st.o; });
    attrState.forEach(function (bag, el) {
      if (!el.isConnected) return;
      Object.keys(bag).forEach(function (a) { if (el.getAttribute(a) === bag[a].s) el.setAttribute(a, bag[a].o); });
    });
    textState.clear();
    attrState.clear();
  }

  function startObserver() {
    if (observer || !global.MutationObserver) return;
    observer = new MutationObserver(function (muts) {
      if (lang !== "en") return;
      if (adminActive()) { set("bn", { persist: false }); return; } // never alter admin-editable text
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === "childList") {
          for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]);
        } else if (m.type === "characterData") {
          xText(m.target);
        } else if (m.type === "attributes") {
          if (m.attributeName === "class") continue;
          xAttrs(m.target);
        }
      }
    });
    observer.observe(document.documentElement, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ATTRS.concat(["class"])
    });
  }

  /* ------------------------------------------------------------------ */
  /*  5. Language switching                                              */
  /* ------------------------------------------------------------------ */
  function readStored() {
    try {
      var q = new URLSearchParams(global.location.search).get("lang");
      if (q && SUPPORTED.indexOf(q) !== -1) return q;
    } catch (e) {}
    try {
      var s = global.localStorage.getItem(STORAGE_KEY);
      if (s && SUPPORTED.indexOf(s) !== -1) return s;
    } catch (e) {}
    return DEFAULT_LANG;
  }

  function syncSwitch() {
    var btns = document.querySelectorAll(".langSwitch .langBtn");
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute("data-lang") === lang;
      btns[i].setAttribute("aria-pressed", on ? "true" : "false");
      btns[i].classList.toggle("active", on);
    }
  }

  function set(next, opts) {
    opts = opts || {};
    if (SUPPORTED.indexOf(next) === -1) return;
    var changed = next !== lang;
    lang = next;
    api.lang = next;
    if (opts.persist !== false) { try { global.localStorage.setItem(STORAGE_KEY, next); } catch (e) {} }
    document.documentElement.setAttribute("lang", next);
    document.documentElement.setAttribute("data-lang", next);
    if (next === "en") { if (!adminActive()) translateAll(); else lang = api.lang = "bn"; }
    else restoreAll();
    applyMeta();
    syncSwitch();
    if (changed || opts.force) {
      listeners.forEach(function (fn) { try { fn(lang); } catch (e) {} });
      try { document.dispatchEvent(new CustomEvent("bnb:langchange", { detail: { lang: lang } })); } catch (e) {}
    }
  }

  var api = {
    lang: DEFAULT_LANG,
    set: set,
    /* Translate a Bangla string for places that bypass the DOM (canvas, share text). */
    t: function (s) { return lang === "en" ? translate(s) : s; },
    fmtDate: fmtDate,
    onChange: function (fn) { if (typeof fn === "function") listeners.push(fn); }
  };
  global.I18N = api;

  /* initial language is decided immediately so app.js can read I18N.lang */
  lang = readStored();
  api.lang = lang;
  document.documentElement.setAttribute("lang", lang);
  document.documentElement.setAttribute("data-lang", lang);
  startObserver();

  function init() {
    document.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest(".langSwitch .langBtn");
      if (b) set(b.getAttribute("data-lang"));
    });
    syncSwitch();
    applyMeta();
    if (lang === "en") {
      if (adminActive()) { set("bn", { persist: false }); } else { translateAll(); }
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(window);
