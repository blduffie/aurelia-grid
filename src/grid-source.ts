import {Grid} from './grid';
import {GridColumn} from './grid-column';

export interface IGridDataSource {
	count: number;
	items: any[];
	loading: boolean;

	/** 1 - first page */
	page: number;
	/** 10 - default page size */
	pageSize: number;
	pageCount: number;
	
	/** Dictionary of sorting name:asc|desc  */
	sorting: Array<GridColumn>;
	
	/** grid was attached - start loading & monitoring for changes */
	attached();
	/** trigger a refresh */
	refresh();
	/** unbind - stop loading and monitoring for changes */
	unbind();
}

/** Shape of the result data */
export interface IGridData {
	count: number;
	data: any[];
}

/** Used in the read callback to ask the local data source for data */
export interface IDataInfo {
	/** 1 - first page */
	page: number;
	/** 10 - default page size */
	pageSize: number;
}

export class GridDataSource implements IGridDataSource {
	count: number;
	items: any[];
	loading: boolean;

	page: number = 1;
	pageSize: number;
	pageCount: number = 0;

	sorting: Array<GridColumn> = new Array<GridColumn>();

	protected grid: Grid;

	constructor(grid: Grid) {
		this.grid = grid;
	}
	
	/** Events from Aurelia */
	pageSizeChanged(newValue: number, oldValue: number) {
		debugger;
		if(newValue == oldValue)
			return;
		this.refresh();
	}

	attached() {
		this.page = 1;

		if (this.grid.pager && this.grid.pager.pageSizes)
			this.pageSize = this.grid.pager.pageSizes[0];
		else
			this.pageSize = 10;
		
		// process page sizes
		if (this.grid.sourceAutoLoad) {
			this.refresh();
		}
	}
	refresh() {
		debugger;
		throw new Error("Data source does not implement read?");
	}

	updatePager() {
		// TODO: 
	}

	onData() {
		if (this.pageSize == 0)
			this.pageSize = 10;
		this.pageCount = Math.ceil(this.count / this.pageSize);
		this.grid.pager.refresh();
	}

	unbind() {
	}
} 

/** Local Source of Grid Data - In Memory Paging and Sorting */
export class LocalGridData extends GridDataSource {
	private dataRead: (event: IDataInfo) => Promise<any>;
	private cache: any[];
	private allItems: any[];

	constructor(grid: Grid) {
		super(grid);
		this.dataRead = grid.sourceRead;
		if (!this.dataRead) {
			throw new Error("'data-read.call' is not defined on the grid.");
		}
	}
	


	refresh() {
		this.loading = true;
		var d = this.dataRead({
			page: this.page,
			pageSize: this.pageSize
		});
		if (d.then) {
			d.then(result=> {
				this.handleResult(result);
				this.loading = false;
			}).catch(error=> {
				if (this.grid.sourceReadError)
					this.grid.sourceReadError(error);
				this.loading = false;
			})
		} else {
			if (Array.isArray(d)) {
				this.handleResult(d, true);
				this.loading = false;
			}
		};
	}

	/** ============ New Data ============== */
	private handleResult(result: any, isArray: boolean = false) {
		var r: IGridData;
		if (this.grid.sourceTransform)
			r = this.grid.sourceTransform(result);
		else {
			if (isArray) {
				r = { data: result, count: result.length };
			} else {
				r = <IGridData>result;
			}
		}

		if (r) {
			this.allItems = r.data;
			this.cache = this.allItems;
			this.count = r.count;

			this.filterAndSortLocalData();
		}
		super.onData();
	}

	private filterAndSortLocalData() {
		// Applies filter, sort then page
		// 1. First filter the data down to the set we want, if we are using local data
		var tempData = this.allItems;

		if (this.grid.columnsCanFilter)
			tempData = this.applyFilter(tempData);

		// 2. Now sort the data
		if (this.grid.columnsCanSort)
			tempData = this.applySort(tempData);

		// 3. Now apply paging
		if (this.grid.paginationEnabled)
			tempData = this.applyPage(tempData);

		this.items = tempData;

		this.updatePager();

		this.watchForChanges();

		setTimeout(() => this.grid.builder.headersSyncColumnHeadersWithColumns.bind(this), 0);
	}


	/** ============ Filtering ============== */
	private applyFilter(data: any[]): any[] {
		return data.filter((row) => {
			var include = true;

			for (var i = this.grid.template.columns.length - 1; i >= 0; i--) {
				var col = this.grid.template.columns[i];

				if (col.filterValue !== "" && row[col.field].toString().indexOf(col.filterValue) === -1) {
					include = false;
				}
			}

			return include;
		});
	}

	private getFilterColumns() {
		var cols = {};

		for (var i = this.grid.template.columns.length - 1; i >= 0; i--) {
			var col = this.grid.template.columns[i];

			if (col.filterValue !== "")
				cols[col.field] = col.filterValue;
		}

		return cols;
	}

	/** ============ Sorting ============== */
	sortChanged(column: GridColumn, event) {
		// Determine new sort
		var newSort = undefined;

		// Figure out which way this field should be sorting
		switch (column.sorting) {
			case "asc":
				newSort = "desc";
				break;
			case "desc":
				newSort = "";
				break;
			default:
				newSort = "asc";
				break;
		}

		if (!event.ctrlKey) {
			this.sorting.forEach(s=> s.sorting = "");
			this.sorting = [];
		}

		column.sorting = newSort;

		// If the sort is present in the sort stack, slice it to the back of the stack, otherwise just add it
		var pos = this.sorting.indexOf(column);

		if (pos > -1)
			this.sorting.splice(pos, 1);

		if (newSort)
			this.sorting.push(column);

		// Apply the new sort
		this.refresh();
	}

	private applySort(data: any[]): any[] {

		//Format the sort fields
		var fields = [];

		// Get the fields in the "sortingORder"
		for (var i = 0; i < this.sorting.length; i++) {
			var col = this.sorting[i];
			fields.push(col.sorting === "asc" ? (col.field) : ("-" + col.field));
		};

		if (this.sorting.length > 0)
			return this.allItems.sort(this.fieldSorter(fields));
		else	// don't go through sort as it messses up data
			return data;
	}

	private fieldSorter(fields) {
		return function(a, b) {
			return fields
				.map(function(o) {
					var dir = 1;
					if (o[0] === '-') {
						dir = -1;
						o = o.substring(1);
					}
					if (a[o] > b[o]) return dir;
					if (a[o] < b[o]) return -(dir);
					return 0;
				})
				.reduce(function firstNonZeroValue(p, n) {
					return p ? p : n;
				}, 0);
		};
	}


	/** ============ Pagination ============== */
	private applyPage(data: any[]): any[] {
		var start = (Number(this.page) - 1) * Number(this.pageSize);

		data = data.slice(start, start + Number(this.pageSize));

		return data;
	}

	/** ============ Monitoring ============== */
	private subscription: any;
	/** Watch for changes to the data */
	private watchForChanges() {
		this.dontWatchForChanges();

		if (!this.grid.unbinding) {
			// We can update the pager automagically
			this.subscription = this.grid.bindingEngine
				.collectionObserver(this.cache)
				.subscribe((splices) => {
					this.refresh();
				});
		}
	}
	private dontWatchForChanges() {
		if (this.subscription) {
			this.subscription.dispose();
			this.subscription = null;
		}
	}

	unbind() {
		super.unbind();
		this.dontWatchForChanges();
	}
}