// -----------------------
    // 
    // -----------------------
    export const IPL_TEAMS = ["DC","GT","RCB","KKR","SRH","RR","LSG","MI","PBKS","CSK"];
    export const ANY_TEAM_OPTION = "ANY TEAM";
    export const WHEEL_SEGMENTS = [...IPL_TEAMS, ANY_TEAM_OPTION];
    export const WHEEL_COLORS = ["white","#060644e6","red","violet","orange","pink","NAVY","BLUE","#ef4444","YELLOW","black"];

    export const IPL_PLAYERS = {
    CSK: [
      // BATTERS
      { name: "Ruturaj Gaikwad", role: "BAT" },
      { name: "Dewald Brevis", role: "BAT" },
      { name: "Sarfaraz Khan", role: "BAT" },
      { name: "Matthew Short", role: "BAT" },

      // WICKETKEEPERS
      { name: "MS Dhoni", role: "WK" },
      { name: "Sanju Samson", role: "WK" },
      { name: "Kartik Sharma", role: "WK" },
      { name: "Urvil Patel", role: "WK" },

      // ALLROUNDERS
      { name: "Shivam Dube", role: "PACE_AR" },
      { name: "Ayush Mhatre", role: "PACE_AR" },
      { name: "Jamie Overton", role: "PACE_AR" },
      { name: "Prashant Veer", role: "PACE_AR" },
      { name: "Shreyas Gopal", role: "SPIN_AR" },

      // BOWLERS
      { name: "Noor Ahmad", role: "SPIN_BOWL" },
      { name: "Khaleel Ahmed", role: "PACE_BOWL" },
      { name: "Rahul Chahar", role: "SPIN_BOWL" },
      { name: "Nathan Ellis", role: "PACE_BOWL" },
      { name: "Gurjapneet Singh", role: "PACE_BOWL" },
      { name: "Matt Henry", role: "PACE_BOWL" },
      { name: "Anshul Kamboj", role: "PACE_BOWL" },
      { name: "Mukesh Choudhary", role: "PACE_BOWL" },
    ],

      MI : [
      // WICKETKEEPERS / BATTERS
      { name: "Quinton de Kock", role: "WK" },
      { name: "Robin Minz", role: "WK" },
      { name: "Ryan Rickelton", role: "WK" },
      { name: "Sherfane Rutherford", role: "BAT" },
      { name: "Rohit Sharma", role: "BAT" },
      { name: "Suryakumar Yadav", role: "BAT" },

      // ALLROUNDERS
      { name: "Hardik Pandya", role: "PACE_AR" },
      { name: "Corbin Bosch", role: "PACE_AR" },
      { name: "Will Jacks", role: "SPIN_AR" },
      { name: "Naman Dhir", role: "SPIN_AR" },
      { name: "Mitchell Santner", role: "SPIN_AR" },
      { name: "Tilak Varma", role: "SPIN_AR" },

      // BOWLERS
      { name: "Ashwani Kumar", role: "PACE_BOWL" },
      { name: "Trent Boult", role: "PACE_BOWL" },
      { name: "Jasprit Bumrah", role: "PACE_BOWL" },
      { name: "Deepak Chahar", role: "PACE_BOWL" },
      { name: "Mayank Markande", role: "SPIN_BOWL" },
      { name: "Shardul Thakur", role: "PACE_BOWL" }
    ],
        RCB : [
      // BATTERS & WICKETKEEPERS
      { name: "Rajat Patidar", role: "BAT" },
      { name: "Jordan Cox", role: "WK" },
      { name: "Tim David", role: "BAT" },
      { name: "Virat Kohli", role: "BAT" },
      { name: "Devdutt Padikkal", role: "BAT" },
      { name: "Phil Salt", role: "WK" },
      { name: "Jitesh Sharma", role: "WK" },

      // ALLROUNDERS
      { name: "Jacob Bethell", role: "SPIN_AR" },
      { name: "Venkatesh Iyer", role: "PACE_AR" },
      { name: "Mangesh Yadav", role: "PACE_AR" },
      { name: "Krunal Pandya", role: "SPIN_AR" },
      { name: "Romario Shepherd", role: "PACE_AR" },

      // BOWLERS
      { name: "Jacob Duffy", role: "PACE_BOWL" },
      { name: "Josh Hazlewood", role: "PACE_BOWL" },
      { name: "Bhuvneshwar Kumar", role: "PACE_BOWL" },
      { name: "Rasikh Salam", role: "PACE_BOWL" },
      { name: "Suyash Sharma", role: "SPIN_BOWL" },
      { name: "Swapnil Singh", role: "SPIN_BOWL" },
      { name: "Nuwan Thushara", role: "PACE_BOWL" },
      { name: "Yash Dayal", role: "PACE_BOWL" }
    ],
      KKR : [
      // BATTERS & WICKETKEEPERS
      { name: "Ajinkya Rahane", role: "BAT" },
      { name: "Finn Allen", role: "BAT" },
      { name: "Manish Pandey", role: "BAT" },
      { name: "Rovman Powell", role: "BAT" },
      { name: "Angkrish Raghuvanshi", role: "BAT" },
      { name: "Ramandeep Singh", role: "BAT" },
      { name: "Tim Seifert", role: "WK" },
      { name: "Rinku Singh", role: "BAT" },

      // ALLROUNDERS
      { name: "Cameron Green", role: "PACE_AR" },
      { name: "Sunil Narine", role: "SPIN_AR" },
      { name: "Rachin Ravindra", role: "SPIN_AR" },

      // BOWLERS
      { name: "Varun Chakravarthy", role: "SPIN_BOWL" },
      { name: "Matheesha Pathirana", role: "PACE_BOWL" },
      { name: "Harshit Rana", role: "PACE_AR" },
      { name: "Akash Deep", role: "PACE_BOWL" },
      { name: "Vaibhav Arora", role: "PACE_BOWL" },
      { name: "Kartik Tyagi", role: "PACE_BOWL" },
      { name: "Umran Malik", role: "PACE_BOWL" },
    ],

      SRH : [
      // WICKETKEEPERS & BATTERS
      { name: "Travis Head", role: "BAT" },
      { name: "Ishan Kishan", role: "WK" },
      { name: "Heinrich Klaasen", role: "WK" },

      // ALLROUNDERS
      { name: "Abhishek Sharma", role: "SPIN_AR" },
      { name: "Brydon Carse", role: "PACE_AR" },
      { name: "Liam Livingstone", role: "SPIN_AR" },
      { name: "Kamindu Mendis", role: "SPIN_AR" },
      { name: "Nitish Kumar Reddy", role: "PACE_AR" },
      { name: "Shivam Mavi", role: "PACE_AR" },

      // BOWLERS
      { name: "Pat Cummins", role: "PACE_BOWL" },
      { name: "Eshan Malinga", role: "PACE_BOWL" },
      { name: "Harshal Patel", role: "PACE_BOWL" },
      { name: "Sakib Hussain", role: "PACE_BOWL" },
      { name: "Shivang Kumar", role: "PACE_BOWL" },
      { name: "Jaydev Unadkat", role: "PACE_BOWL" },
      { name: "Zeeshan Ansari", role: "SPIN_BOWL" }
],
      RR : [
      // BATTERS & WICKETKEEPERS
      { name: "Shimron Hetmyer", role: "BAT" },
      { name: "Yashasvi Jaiswal", role: "BAT" },
      { name: "Dhruv Jurel", role: "WK" },
      { name: "Riyan Parag", role: "BAT" },
      { name: "Vaibhav Sooryavanshi", role: "BAT" },

      // ALLROUNDERS
      { name: "Sam Curran", role: "PACE_AR" },
      { name: "Donovan Ferreira", role: "SPIN_AR" },
      { name: "Ravindra Jadeja", role: "SPIN_AR" },

      // BOWLERS
      { name: "Jofra Archer", role: "PACE_BOWL" },
      { name: "Nandre Burger", role: "PACE_BOWL" },
      { name: "Tushar Deshpande", role: "PACE_BOWL" },
      { name: "Vignesh Puthur", role: "SPIN_BOWL" },
      { name: "Ravi Bishnoi", role: "SPIN_BOWL" },
      { name: "Sandeep Sharma", role: "PACE_BOWL" },
      { name: "Kuldeep Sen", role: "PACE_BOWL" },
      { name: "Yudhvir Singh", role: "PACE_BOWL" }
    ],
      GT : [
  // BATTERS & WICKETKEEPERS
      { name: "Shubman Gill", role: "BAT" },
      { name: "Anuj Rawat", role: "WK" },
      { name: "Tom Banton", role: "WK" },
      { name: "Jos Buttler", role: "WK" },
      { name: "Kumar Kushagra", role: "WK" },
      { name: "Sai Sudharsan", role: "BAT" },
      { name: "M Shahrukh Khan", role: "BAT" },

      // ALLROUNDERS
      { name: "Jason Holder", role: "PACE_AR" },
      { name: "Glenn Phillips", role: "SPIN_AR" },
      { name: "Rashid Khan", role: "SPIN_BOWL" },
      { name: "Rahul Tewatia", role: "SPIN_AR" },
      { name: "Washington Sundar", role: "SPIN_AR" },

      // BOWLERS
      { name: "Mohammed Siraj", role: "PACE_BOWL" },
      { name: "Prasidh Krishna", role: "PACE_BOWL" },
      { name: "Kagiso Rabada", role: "PACE_BOWL" },
      { name: "Sai Kishore", role: "SPIN_BOWL" },
      { name: "Ishant Sharma", role: "PACE_BOWL" },
      { name: "Luke Wood", role: "PACE_BOWL" },
      { name: "Jayant Yadav", role: "SPIN_BOWL" }
    ],
    LSG : [
  // WICKETKEEPERS & BATTERS
      { name: "Rishabh Pant", role: "WK" },
      { name: "Abdul Samad", role: "BAT" },
      { name: "Akshat Raghuwanshi", role: "BAT" },
      { name: "Ayush Badoni", role: "BAT" },
      { name: "Matthew Breetzke", role: "BAT" },
      { name: "Josh Inglis", role: "WK" },
      { name: "Aiden Markram", role: "BAT" },
      { name: "Nicholas Pooran", role: "WK" },

      // ALLROUNDERS
      { name: "Wanindu Hasaranga", role: "SPIN_AR" },
      { name: "Arshin Kulkarni", role: "PACE_AR" },
      { name: "Mitchell Marsh", role: "PACE_AR" },
      { name: "Shahbaz Ahmed", role: "SPIN_AR" },

      // BOWLERS
      { name: "Akash Singh", role: "PACE_BOWL" },
      { name: "Avesh Khan", role: "PACE_BOWL" },
      { name: "Mohammed Shami", role: "PACE_BOWL" },
      { name: "Mohsin Khan", role: "PACE_BOWL" },
      { name: "Anrich Nortje", role: "PACE_BOWL" },
      { name: "Prince Yadav", role: "PACE_BOWL" },
      { name: "Digvesh Rathi", role: "SPIN_BOWL" },
      { name: "Arjun Tendulkar", role: "PACE_BOWL" },
      { name: "Mayank Yadav", role: "PACE_BOWL" }
    ],
      DC : [
      // WICKETKEEPERS & BATTERS
      { name: "Abishek Porel", role: "WK" },
      { name: "Ben Duckett", role: "BAT" },
      { name: "David Miller", role: "BAT" },
      { name: "Karun Nair", role: "BAT" },
      { name: "Pathum Nissanka", role: "BAT" },
      { name: "KL Rahul", role: "WK" },
      { name: "Nitish Rana", role: "BAT" },
      { name: "Sameer Rizvi", role: "BAT" },
      { name: "Prithvi Shaw", role: "BAT" },
      { name: "Tristan Stubbs", role: "BAT" },

      // ALLROUNDERS
      { name: "Axar Patel", role: "SPIN_AR" },
      { name: "Ashutosh Sharma", role: "PACE_AR" },

      // BOWLERS
      { name: "Auqib Nabi", role: "PACE_BOWL" },
      { name: "Dushmantha Chameera", role: "PACE_BOWL" },
      { name: "Kyle Jamieson", role: "PACE_BOWL" },
      { name: "Kuldeep Yadav", role: "SPIN_BOWL" },
      { name: "Mukesh Kumar", role: "PACE_BOWL" },
      { name: "T Natarajan", role: "PACE_BOWL" },
      { name: "Lungi Ngidi", role: "PACE_BOWL" },
      { name: "Vipraj Nigam", role: "SPIN_BOWL" },
      { name: "Mitchell Starc", role: "PACE_BOWL" },
    ],
      PBKS : [
      // BATTERS & WICKETKEEPERS
      { name: "Shreyas Iyer", role: "BAT" },
      { name: "Priyansh Arya", role: "BAT" },
      { name: "Mitchell Owen", role: "BAT" },
      { name: "Prabhsimran Singh", role: "WK" },
      { name: "Nehal Wadhera", role: "BAT" },

      // ALLROUNDERS
      { name: "Azmatullah Omarzai", role: "PACE_AR" },
      { name: "Cooper Connolly", role: "SPIN_AR" },
      { name: "Marco Jansen", role: "PACE_AR" },
      { name: "Musheer Khan", role: "SPIN_AR" },
      { name: "Shashank Singh", role: "PACE_AR" },
      { name: "Marcus Stoinis", role: "PACE_AR" },

      // BOWLERS
      { name: "Arshdeep Singh", role: "PACE_BOWL" },
      { name: "Xavier Bartlett", role: "PACE_BOWL" },
      { name: "Yuzvendra Chahal", role: "SPIN_BOWL" },
      { name: "Praveen Dubey", role: "SPIN_BOWL" },
      { name: "Ben Dwarshuis", role: "PACE_BOWL" },
      { name: "Lockie Ferguson", role: "PACE_BOWL" },
      { name: "Harpreet Brar", role: "SPIN_BOWL" },
      { name: "Vijaykumar Vyshak", role: "PACE_BOWL" },
      { name: "Yash Thakur", role: "PACE_BOWL" }
    ]
    };

    // -----------------------
    // Rules, ratings and helper sets
    // -----------------------
    export const SQUAD_SIZE = 12;
    export const MAX_PER_TEAM = 2;
    export const MAX_FOREIGN = 4;

    export const FOREIGN_PLAYERS = new Set([
        // CSK
        "Dewald Brevis",
        "Matthew Short",
        "Jamie Overton",
        "Nathan Ellis",
        "Matt Henry",
        "Noor Ahmad",

        // MI
        "Quinton de Kock",
        "Ryan Rickelton",
        "Sherfane Rutherford",
        "Corbin Bosch",
        "Will Jacks",
        "Mitchell Santner",
        "Trent Boult",

        // RCB
        "Jordan Cox",
        "Tim David",
        "Phil Salt",
        "Jacob Bethell",
        "Romario Shepherd",
        "Jacob Duffy",
        "Josh Hazlewood",
        "Nuwan Thushara",

        // KKR
        "Finn Allen",
        "Rovman Powell",
        "Tim Seifert",
        "Cameron Green",
        "Sunil Narine",
        "Rachin Ravindra",
        "Matheesha Pathirana",

        // SRH
        "Travis Head",
        "Heinrich Klaasen",
        "Brydon Carse",
        "Liam Livingstone",
        "Kamindu Mendis",
        "Pat Cummins",
        "Eshan Malinga",

        // RR
        "Shimron Hetmyer",
        "Sam Curran",
        "Donovan Ferreira",
        "Jofra Archer",
        "Nandre Burger",

        // GT
        "Tom Banton",
        "Jos Buttler",
        "Jason Holder",
        "Glenn Phillips",
        "Rashid Khan",
        "Kagiso Rabada",
        "Luke Wood",

        // LSG
        "Matthew Breetzke",
        "Josh Inglis",
        "Aiden Markram",
        "Nicholas Pooran",
        "Wanindu Hasaranga",
        "Mitchell Marsh",
        "Anrich Nortje",

        // DC
        "Ben Duckett",
        "David Miller",
        "Pathum Nissanka",
        "Tristan Stubbs",
        "Dushmantha Chameera",
        "Kyle Jamieson",
        "Lungi Ngidi",
        "Mitchell Starc",

        // PBKS
        "Mitchell Owen",
        "Azmatullah Omarzai",
        "Cooper Connolly",
        "Marco Jansen",
        "Marcus Stoinis",
        "Xavier Bartlett",
        "Ben Dwarshuis",
        "Lockie Ferguson"
      ]);



    export const ROLE_BASE = {BAT:7.4,AR:7.8,BOWL:7.2,WK:7.3};
    export const ROLE_GROUPS = {
      SPIN_BOWL: "BOWL",
      PACE_BOWL: "BOWL",
      SPIN_AR: "AR",
      PACE_AR: "AR"
    };
    export const FORM_PLAYERS = new Set([
      "Virat Kohli","Rohit Sharma","Phil Salt","Suryakumar Yadav","Jasprit Bumrah","Hardik Pandya",
      "Travis Head","Abhishek Sharma","Heinrich Klaasen","Pat Cummins","T Natarajan",
      "Yashasvi Jaiswal","Riyan Parag","Trent Boult","Rashid Khan","Quinton de Kock","Ryan Rickelton",
      "Shubman Gill","Sai Sudharsan","Rashid Khan","KL Rahul","Nicholas Pooran","Marcus Stoinis",
      "Rishabh Pant","Axar Patel","Tristan Stubbs", "Dewald Brevis","Josh Inglis","Aiden Markram",
      "Sam Curran","Liam Livingstone","Arshdeep Singh","Ravindra Jadeja","Shivam Dube","Sunil Narine",
      "Andre Russell","Mitchell Starc","Ishan Kishan","Kuldeep Yadav","Tim David","Sanju Samson",
      "Josh Hazlewood","Marco Jansen","Axar Patel","Varun Chakravarthy","Rinku Singh","Finn Allen","Tim Seifert",
      "Jacob Bethell","Vaibhav Sooryavanshi","Shreyas Iyer",

    ]);


    
    export const PLAYER_RECORD_CAPS = {
    
      "Pat Cummins": { maxRuns: 66, maxWickets: 4 },
      "Prasidh Krishna": { maxRuns: 4, maxWickets: 4 },
      "Spencer Johnson": { maxRuns: 5, maxWickets: 2 },
      "Jasprit Bumrah": { maxRuns: 16, maxWickets: 4 },
      "Noor Ahmad": { maxRuns: 21, maxWickets: 4 },
      "Josh Hazlewood": { maxRuns: 22, maxWickets: 4 },
      "Jaydev Unadkat": { maxRuns: 26, maxWickets: 3 },
      "Harpreet Brar": { maxRuns: 29, maxWickets: 3 },
      "Virat Kohli": { maxRuns: 113, maxWickets: 0 },
      "Rohit Sharma": { maxRuns: 109, maxWickets: 0 },
      "Shubman Gill": { maxRuns: 129, maxWickets: 1 },
      "Sanju Samson": { maxRuns: 119, maxWickets: 1 },
      "Travis Head": { maxRuns: 102, maxWickets: 1 },
      "Heinrich Klaasen": { maxRuns: 104, maxWickets: 0 }
    };
    
    export const DEFAULT_MAX_RUNS = { BAT: 123, WK: 104, AR: 101, BOWL: 40 };
    export const DEFAULT_MAX_WICKETS = { BAT: 1, WK: 1, AR: 3, BOWL: 4 };
    export const PLAYER_STATS_STORAGE_KEY = "ipl_dynamic_player_stats_v1";
    export const PLAYER_STATS_META_STORAGE_KEY = "ipl_dynamic_player_stats_meta_v1";
    export const PLAYER_SYNC_BATCH_SIZE = 8;
    export const COMPETITION_WEIGHTS = { ipl: 0.7, international: 0.3 };
    export const CRICAPI_BASE_URL = "https://api.cricapi.com/v1";
    
    export const BAT_SR_PROFILES = {
      "Travis Head": 183, "Abhishek Sharma": 180, "Nicholas Pooran": 169, "Heinrich Klaasen": 170,
      "Phil Salt": 182, "Sunil Narine": 176, "Tim David": 178,"Sanju Samson":176,"Jacob Bethell":175,
      "Suryakumar Yadav": 166, "Rohit Sharma": 163, "Virat Kohli": 164, "Shubman Gill": 149,
      "Yashasvi Jaiswal": 176, "Riyan Parag": 150, "KL Rahul": 137,"Vaibhav Sooryavanshi":180,
      "Rishabh Pant": 148, "Ishan Kishan": 181, "Jitesh Sharma": 174, "Liam Livingstone": 166,
      "Marcus Stoinis": 154, "David Miller": 145, "Tilak Varma": 146, "Sai Sudharsan": 142,
      "Rinku Singh": 170, "Rajat Patidar": 152, "Shivam Dube": 170, "Devon Conway": 141,"Hardik Pandya" : 173,
      "Tristan Stubbs":168,"Josh Inglis":158,"Aiden Markram":154,"Shreyas Iyer":160
    };
    export const OPENER_SPECIALISTS = {
      "Rohit Sharma": 0.9,"Phil Salt": 1.2,"Sanju Samson":0.9, "Shubman Gill": 0.95, "Yashasvi Jaiswal": 1.0, "Travis Head": 1.2,
      "Abhishek Sharma": 1.2, "Ishan Kishan": 1.22, "Ruturaj Gaikwad": 0.88, "Sai Sudharsan": 0.82,
      "Virat Kohli": 0.93, "Quinton de Kock": 0.92, "Rishabh Pant": 0.65,"Mitchell Marsh": 0.82,
      "Jos Buttler": 1.0, "KL Rahul": 0.72, "Aiden Markram": 0.68, "Prabhsimran Singh": 0.8,"Jacob Bethell":0.85,
      "Vaibhav Sooryavanshi":0.8,"Nicholas Pooran":0.75
    };
    export const MIDDLE_ORDER_SPECIALISTS = {
      "Suryakumar Yadav": 0.90, "KL Rahul": 0.9,"Phil Salt": 1.2, "Riyan Parag": 0.82, "Tilak Varma": 0.8,"Virat Kohli": 0.92,
      "Sai Sudharsan": 0.86, "Rajat Patidar": 0.78, "Shivam Dube": 0.7, "Tristan Stubbs": 0.9,"Josh Inglis":0.75,"Abhishek Sharma": 1.2,
      "Sanju Samson": 0.8, "Heinrich Klaasen": 0.84, "David Miller": 0.75,"Travis Head": 1.2,
      "Rinku Singh": 0.68, "Liam Livingstone": 0.72, "Shreyas Iyer": 0.86,"Nicholas Pooran": 0.92, "Ishan Kishan": 1.2,
    };
    export const FINISHER_SPECIALISTS = {
      "Hardik Pandya": 0.92, "Tim David": 1.8, "Rinku Singh": 1.4, "MS Dhoni": 0.68,
      "David Miller": 0.9, "Marcus Stoinis": 0.86, "Tristan Stubbs": 0.95, 
      "Heinrich Klaasen": 0.86, "Shivam Dube": 0.7, "Jitesh Sharma": 0.72, "Nehal Wadhera": 0.7,
      "Ravindra Jadeja": 0.68, "Romario Shepherd": 1.9, "Mitchell Marsh": 0.62
    };
    export const BOWL_ECON_PROFILES = {
      "Jasprit Bumrah": 5.9, "Josh Hazlewood": 6.2, "Mitchell Starc": 6.6, "Mohammad Shami": 8.1, "Mohammed Shami": 8.1,
      "Rashid Khan": 6.9, "Sunil Narine": 6.8, "Varun Chakaravarthy": 6.2, "Varun Chakravarthy": 6.2, "Kuldeep Yadav": 6.3,
      "Noor Ahmad": 7.7, "Trent Boult": 8.0, "Arshdeep Singh": 7.5, "Pat Cummins": 8.4,
      "Avesh Khan": 8.6, "Harshit Rana": 8.7, "Bhuvneshwar Kumar": 7.9, "Mohammad Siraj": 8.4, "Mohammed Siraj": 8.4,
      "Prasidh Krishna": 8.2, "T Natarajan": 8.8, "Yuzvendra Chahal": 7.8, "Ravi Bishnoi": 7.7
    };
    export const BOWL_WICKET_SKILL = {
      "Jasprit Bumrah": 1.99, "Josh Hazlewood": 1.95, "Mitchell Starc": 1.92, "Mohammad Shami": 1.22,
      "Rashid Khan": 1.97, "Sunil Narine": 1.2, "Varun Chakaravarthy": 1.98, "Kuldeep Yadav": 1.72,
      "Noor Ahmad": 1.48, "Trent Boult": 1.35, "Arshdeep Singh": 1.82, "Pat Cummins": 1.08,"Mohammed Siraj":1.48,
      "Axar Patel":1.2
    };
    
