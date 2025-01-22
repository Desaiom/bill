const express = require("express");
const session = require("express-session");
const bodyParser = require("body-parser");
const path = require("path");
const { jsPDF } = require("jspdf"); // Corrected import
require("jspdf-autotable"); // Import the plugin
const mysql = require("mysql2");
const app = express();
const PORT = 8080;
const fs = require("fs");

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.set("view engine", "ejs");

// Connect to DB
const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "pass123",
  database: "project",
});

// Middleware for session
app.use(
  session({
    secret: "omdon", // Replace with a strong secret key
    resave: false,
    saveUninitialized: false,
  })
);

// Middleware to check login state
function checkAuth(req, res, next) {
  if (req.session.user) {
    next();
  } else {
    res.redirect("/login");
  }
}

app.use((req, res, next) => {
  res.locals.user = req.session.user; // Pass user session to views
  next();
});

app.get("/login", (req, res) => {
  res.render("login");
});

// Modify Login Route
app.post("/login", (req, res) => {
  const { username, password } = req.body;

  const query = "SELECT * FROM users WHERE username = ? AND password = ?";

  db.query(query, [username, password], (err, results) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }

    if (results.length > 0) {
      // Store user info in session
      req.session.user = results[0];
      res.json({ message: "Login successful" }); // Send success message
    } else {
      res.status(401).json({ message: "Invalid username or password" }); // Send error as JSON
    }
  });
});

// Logout Route
app.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error(err);
      res.status(500).send("Logout error");
    } else {
      res.redirect("/login");
    }
  });
});

// Example: Protect Routes with Authentication Middleware
app.get("/", checkAuth, (req, res) => {
  res.render("home", { user: req.session.user });
});

// Route to fetch customers and render the page
app.get("/customer", (req, res) => {
  const query = "SELECT * FROM customers";
  const editIndex = req.query.editIndex
    ? parseInt(req.query.editIndex, 10)
    : null; // Default to null if not provided

  db.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching customers:", err);
      return res
        .status(500)
        .send("An error occurred while fetching customers.");
    }
    res.render("customer", { customers: results, editIndex }); // Pass editIndex to the EJS template
  });
});

// Route to add a new customer
app.post("/add", (req, res) => {
  const { customerName } = req.body;

  // Server-side validation for required fields
  if (!customerName) {
    return res.status(400).send("Customer Name is required.");
  }

  // Insert only the customerName; customerId is auto-generated
  const insertQuery = "INSERT INTO customers (customerName) VALUES (?)";
  db.query(insertQuery, [customerName], (err) => {
    if (err) {
      console.error("Error adding customer:", err);
      return res
        .status(500)
        .send("An error occurred while adding the customer.");
    }
    res.redirect("/customer");
  });
});

app.post("/update/:customerId", (req, res) => {
  const { customerId } = req.params;
  const { customerName } = req.body;

  const query = "UPDATE customers SET customerName = ? WHERE customerId = ?";
  db.query(query, [customerName, customerId], (err) => {
    if (err) {
      console.error("Error updating customer:", err);
      res.status(500).send(err);
    } else {
      res.redirect("/customer");
    }
  });
});

app.post("/delete/:customerId", (req, res) => {
  const { customerId } = req.params;

  const query = "DELETE FROM customers WHERE customerId = ?";
  db.query(query, [customerId], (err) => {
    if (err) {
      console.error("Error deleting customer:", err);
      res.status(500).send(err);
    } else {
      res.redirect("/customer");
    }
  });
});

// Default data
const defaultBillData = {
  items: [
    {
      description: "SK PATTI MUKT",
      net: 2000,
      percentage: 71,
      wastage: 5,
      fine: 2035,
      mcRate: 0.802,
      amount: 1632.07,
    },
    {
      description: "SHIV GHATMUR",
      net: 3500,
      percentage: 81,
      wastage: 10,
      fine: 1123,
      mcRate: 0.6,
      amount: 673.8,
    },
  ],
};

// Route to render the bill form
app.get("/generate-bill", (req, res) => {
  const items = defaultBillData.items.map((item) => ({
    ...item,
    fine: item.net * ((item.percentage + item.wastage) / 100), // Fine formula
    amount: item.net * item.mcRate, // Amount formula
  }));
  const totalNet = items.reduce((sum, item) => sum + item.net, 0);
  const totalFine = items.reduce((sum, item) => sum + item.fine, 0);
  const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);

  res.render("bill", { items, totalNet, totalFine, totalAmount });
});

app.post("/generate-bill", (req, res) => {
  const items = req.body.items.map((item) => ({
    description: item.description,
    net: parseFloat(item.net),
    percentage: parseFloat(item.percentage),
    wastage: parseFloat(item.wastage),
    mcRate: parseFloat(item.mcRate),
    fine:
      parseFloat(item.net) *
      ((parseFloat(item.percentage) + parseFloat(item.wastage)) / 100), // Fine formula
    amount: parseFloat(item.net) * parseFloat(item.mcRate), // Amount formula
  }));

  const totalNet = items.reduce((sum, item) => sum + item.net, 0);
  const totalFine = items.reduce((sum, item) => sum + item.fine, 0);
  const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);

  const doc = new jsPDF();

  // Add Om Logo
  const logoPath = path.join(__dirname, "public", "om_logo.png");
  const imgData = fs.readFileSync(logoPath, { encoding: "base64" }); // Read the logo file
  doc.addImage(imgData, "PNG", 90, 40, 30, 30); // Adjusted dimensions for smaller logo

  // Add Header
  doc.setFontSize(12);
  doc.text("Rough Estimation", 90, 70); // Center-aligned

  // Add current date and time
  const currentDate = new Date().toLocaleString();
  doc.text(`Date: ${currentDate}`, 10, 85);

  // Add "Shri.JP"
  doc.setFontSize(14);
  doc.text("Shri.JP", 90, 85); // Centered below the date and time

  // Prepare table data
  const tableData = items.map((item) => [
    item.description,
    item.net.toFixed(2),
    item.percentage.toFixed(2),
    item.wastage.toFixed(2),
    item.fine.toFixed(2),
    item.mcRate.toFixed(3),
    item.amount.toFixed(2),
  ]);

  tableData.push([
    "Total",
    totalNet.toFixed(2),
    "-",
    "-",
    totalFine.toFixed(2),
    "-",
    totalAmount.toFixed(2),
  ]);

  // Generate the table
  doc.autoTable({
    startY: 90,
    head: [["Description", "Net", "%", "Wastage", "Fine", "Mc@", "Amount"]],
    body: tableData,
    styles: {
      lineWidth: 0.5, // Add borders
      lineColor: [0, 0, 0], // Black border color
    },
    tableLineColor: [0, 0, 0],
    tableLineWidth: 0.5,
  });

  // Add total amount and fine balance after the table
  const yPosition = doc.lastAutoTable.finalY + 10; // Get the position after the table
  doc.text(`Total Amount: Rs:${totalAmount.toFixed(2)}`, 10, yPosition);
  doc.text(`Fine Balance: Rs:${totalFine.toFixed(2)}`, 10, yPosition + 10);

  // Save and send the file
  const pdfPath = path.join(__dirname, "public", "bill.pdf");
  doc.save(pdfPath);

  res.download(pdfPath, "bill.pdf", (err) => {
    if (err) {
      console.error("Error while downloading the PDF:", err);
      res.status(500).send("Error generating the PDF");
    }
  });
});

//Add Items Routes
app.get("/items", (req, res) => {
  const query = "SELECT * FROM items";
  db.query(query, (err, results) => {
    if (err) return res.status(500).send("Error fetching items");

    res.render("addItems", { items: results, editIndex: null });
  });
});

app.post("/addItem", (req, res) => {
  const { itemName, openingStock } = req.body;

  const query = "INSERT INTO items (itemName, openingStock) VALUES (?, ?)";
  db.query(query, [itemName, openingStock || 0], (err) => {
    if (err) return res.status(500).send("Error adding item");

    res.redirect("/items");
  });
});

app.get("/editItem/:id", (req, res) => {
  const { id } = req.params;

  const query = "SELECT * FROM items WHERE id = ?";
  db.query(query, [id], (err, results) => {
    if (err) {
      console.error("Error fetching item:", err);
      return res.status(500).send("Internal Server Error");
    }

    if (results.length === 0) {
      return res.status(404).send("Item not found");
    }

    res.render("addItems", {
      items: results, // List of items or just one
      editIndex: results[0].id, // ID of the item to edit
    });
  });
});

app.post("/updateItem/:id", (req, res) => {
  const { id } = req.params;
  const { itemName, openingStock } = req.body;

  const query = "UPDATE items SET itemName = ?, openingStock = ? WHERE id = ?";
  db.query(query, [itemName, openingStock || 0, id], (err) => {
    if (err) {
      console.error("Error updating item:", err);
      return res.status(500).send("Internal Server Error");
    }

    res.redirect("/items"); // Redirect to the items list after updating
  });
});

app.post("/deleteItem/:id", (req, res) => {
  const { id } = req.params;

  const query = "DELETE FROM items WHERE id = ?";
  db.query(query, [id], (err) => {
    if (err) return res.status(500).send("Error deleting item");

    res.redirect("/items");
  });
});

//TRansactions
// Render the form and transaction list
app.get("/add-transaction", (req, res) => {
  const getTransactionsQuery = "SELECT * FROM transactions";
  const editIndex = req.query.editIndex ? parseInt(req.query.editIndex) : null; // Parse query param if available
  db.query(getTransactionsQuery, (err, results) => {
    if (err) throw err;
    res.render('transaction', {  transactions: results, editIndex });
    
  });
});

// Add a transaction
app.post("/add-transaction", (req, res) => {
  const {
    JamaOrNave,
    date,
    transactionType,
    customerName,
    itemName,
    netWeight,
    touch,
    wastage,
    mc,
    rate,
    amount,
    fine,
    tmc,
  } = req.body;

  const insertQuery = `INSERT INTO transactions (JamaOrNave, date, transactionType, customerName, itemName, netWeight, touch, wastage, mc, rate, amount, fine, tmc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  db.query(
    insertQuery,
    [
      JamaOrNave,
      date,
      transactionType,
      customerName,
      itemName,
      netWeight,
      touch,
      wastage,
      mc,
      rate,
      amount,
      fine,
      tmc,
    ],
    (err) => {
      if (err) throw err;
      res.redirect("/add-transaction");
    }
  );
});

// Delete a transaction
app.post("/delete-transaction/:id", (req, res) => {
  const { id } = req.params;
  const deleteQuery = "DELETE FROM transactions WHERE id = ?";

  db.query(deleteQuery, [id], (err) => {
    if (err) throw err;
    res.redirect("/add-transaction");
  });
});

// Route to display transactions
app.get("/transactions", (req, res) => {
  const query = "SELECT * FROM transactions"; // SQL query to fetch all transactions
  db.query(query, (err, transactions) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({ error: "Database error while fetching transactions." });
    }
    const editIndex = req.query.editIndex ? parseInt(req.query.editIndex, 10) : null;
    res.render("transaction", { transactions, editIndex });
  });
});

app.post('/update-transaction/:id', (req, res) => {
  const { id } = req.params; // Extract transaction ID from URL params

  console.log("Transaction ID:", id); // Debugging log
  console.log("Received data:", req.body); // Debugging log

  const {
    touch,
    wastage,
    mc,
    rate,
    amount,
    fine,
    tmc,
  } = req.body; // Extract updated values from the request body

  // Validate required fields
  if (
    !id ||
    !touch ||
    !wastage ||
    !mc ||
    !rate ||
    !tmc
  ) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  // Parse numeric values to ensure they are valid
  const parsedTouch = parseFloat(touch) || 0;
  const parsedWastage = parseFloat(wastage) || 0;
  const parsedMC = parseFloat(mc) || 0;
  const parsedRate = parseFloat(rate) || 0;
  const parsedTMC = parseFloat(tmc) || 0;

  // Calculate amount and fine if not provided
  const calculatedFine =
    (parsedTouch + parsedWastage) / 100 || 0;
  const finalAmount =
    amount !== undefined ? parseFloat(amount) : 0;
  const finalFine = fine !== undefined ? parseFloat(fine) : calculatedFine;

  // SQL query to update the transaction in the database, excluding the first 4 columns
  const query = `
    UPDATE transactions
    SET 
      touch = ?, 
      wastage = ?, 
      mc = ?, 
      rate = ?, 
      amount = ?, 
      fine = ?, 
      tmc = ?
    WHERE id = ?
  `;

  // Execute the SQL query
  db.execute(
    query,
    [
      parsedTouch,
      parsedWastage,
      parsedMC,
      parsedRate,
      finalAmount,
      finalFine,
      parsedTMC,
      id,
    ],
    (err) => {
      if (err) {
        console.error("Database error:", err);
        return res.status(500).json({ error: "Database error while updating the transaction." });
      }
      res.redirect("/transactions"); // Redirect to the transaction list after update
    }
  );
});



// Start server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
